package org.hl7.davinci.security;

import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import static org.junit.jupiter.api.Assertions.*;

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
}
