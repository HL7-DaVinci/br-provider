package org.hl7.davinci.security;

import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MutableRegisteredClientRepositoryTest {

    private MutableRegisteredClientRepository repo;

    @BeforeEach
    void setUp() {
        repo = new MutableRegisteredClientRepository();
    }

    private RegisteredClient buildClient(String clientId) {
        return RegisteredClient.withId(UUID.randomUUID().toString())
            .clientId(clientId)
            .clientName("Test Client")
            .clientAuthenticationMethod(ClientAuthenticationMethod.PRIVATE_KEY_JWT)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .redirectUri("https://example.com/callback")
            .scope("openid")
            .build();
    }

    @Test
    void save_and_findByClientId() {
        RegisteredClient client = buildClient("client-1");
        repo.save(client);
        assertEquals(client, repo.findByClientId("client-1"));
    }

    @Test
    void save_and_findById() {
        RegisteredClient client = buildClient("client-2");
        repo.save(client);
        assertEquals(client, repo.findById(client.getId()));
    }

    @Test
    void findByClientId_notFound_returnsNull() {
        assertNull(repo.findByClientId("nonexistent"));
    }

    @Test
    void saveWithIssuer_findByIssuer() {
        RegisteredClient client = buildClient("client-3");
        repo.saveWithIssuer(client, "https://issuer.example.com");
        assertEquals(client, repo.findByIssuer("https://issuer.example.com"));
    }

    @Test
    void findByIssuer_notFound_returnsNull() {
        assertNull(repo.findByIssuer("https://unknown.example.com"));
    }

    @Test
    void saveWithIssuer_overwritesExisting() {
        RegisteredClient client1 = buildClient("client-old");
        repo.saveWithIssuer(client1, "https://issuer.example.com");

        RegisteredClient client2 = buildClient("client-new");
        repo.saveWithIssuer(client2, "https://issuer.example.com");

        assertEquals(client2, repo.findByIssuer("https://issuer.example.com"));
    }

    @Test
    void findByClientId_missDelegatesToRecovery() {
        TieredClientRecovery recovery = mock(TieredClientRecovery.class);
        RegisteredClient recovered = buildClient("recovered-client");
        when(recovery.recover("missing-client")).thenReturn(recovered);
        MutableRegisteredClientRepository repoWithRecovery = new MutableRegisteredClientRepository(recovery);

        assertEquals(recovered, repoWithRecovery.findByClientId("missing-client"));
        verify(recovery).recover("missing-client");
    }

    @Test
    void findByClientId_hitDoesNotDelegateToRecovery() {
        TieredClientRecovery recovery = mock(TieredClientRecovery.class);
        MutableRegisteredClientRepository repoWithRecovery = new MutableRegisteredClientRepository(recovery);
        RegisteredClient client = buildClient("client-hit");
        repoWithRecovery.save(client);

        assertEquals(client, repoWithRecovery.findByClientId("client-hit"));
        verifyNoInteractions(recovery);
    }

    private static RegisteredClient clientWithId(String clientId) {
        return RegisteredClient.withId(clientId)
            .clientId(clientId)
            .clientAuthenticationMethod(ClientAuthenticationMethod.PRIVATE_KEY_JWT)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .build();
    }

    @Test
    void saveRecovered_evictsOldestBeyondCap() {
        MutableRegisteredClientRepository repo = new MutableRegisteredClientRepository();
        for (int i = 0; i <= MutableRegisteredClientRepository.MAX_RECOVERED_CLIENTS; i++) {
            repo.saveRecovered(clientWithId("recovered-" + i), "https://issuer-" + i);
        }
        assertNull(repo.findByClientId("recovered-0"));
        assertNull(repo.findByIssuer("https://issuer-0"));
        assertNotNull(repo.findByClientId("recovered-1"));
        assertNotNull(repo.findByClientId(
            "recovered-" + MutableRegisteredClientRepository.MAX_RECOVERED_CLIENTS));
    }

    @Test
    void realRegistrationLiftsRecoveredCapForThatClient() {
        MutableRegisteredClientRepository repo = new MutableRegisteredClientRepository();
        repo.saveRecovered(clientWithId("promoted"), "https://promoted");
        repo.saveWithIssuer(clientWithId("promoted"), "https://promoted");
        for (int i = 0; i <= MutableRegisteredClientRepository.MAX_RECOVERED_CLIENTS; i++) {
            repo.saveRecovered(clientWithId("recovered-" + i), "https://issuer-" + i);
        }
        assertNotNull(repo.findByClientId("promoted"));
    }
}
