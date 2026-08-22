package org.hl7.davinci.security;

import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.junit.jupiter.api.Assertions.*;

class TieredClientRecoveryTest {

    private static final String ISSUER = "https://localhost:5055";

    private MutableRegisteredClientRepository repo;
    private UdapClientKeyStore keyStore;
    private TieredClientRecovery recovery;

    @BeforeEach
    void setUp() {
        repo = new MutableRegisteredClientRepository();
        keyStore = new UdapClientKeyStore();
        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("http://localhost:8080");
        recovery = new TieredClientRecovery(props, repo);
    }

    @AfterEach
    void clearRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void matchingRedirectAndRequest_recoversClientWithRedirectAndAuthCode() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setParameter("redirect_uri", ISSUER + "/callback");
        request.setParameter("scope", "udap openid");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        String clientId = TieredClientIds.encode(ISSUER);
        RegisteredClient client = recovery.recover(clientId);

        assertNotNull(client);
        assertEquals(clientId, client.getClientId());
        assertTrue(client.getClientAuthenticationMethods().contains(ClientAuthenticationMethod.PRIVATE_KEY_JWT));
        assertTrue(client.getAuthorizationGrantTypes().contains(AuthorizationGrantType.AUTHORIZATION_CODE));
        assertTrue(client.getAuthorizationGrantTypes().contains(AuthorizationGrantType.REFRESH_TOKEN));
        assertEquals(Set.of(ISSUER + "/callback"), client.getRedirectUris());
        assertEquals(Set.of("udap", "openid"), client.getScopes());
        assertNull(keyStore.get(clientId));
        assertEquals(client, repo.findByClientId(clientId));
    }

    @Test
    void redirectUriWithDifferentOrigin_recoversRefreshOnlyClientWithoutRedirectUris() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setParameter("redirect_uri", "https://evil.example.com/callback");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        String clientId = TieredClientIds.encode(ISSUER);
        RegisteredClient client = recovery.recover(clientId);

        assertNotNull(client);
        assertTrue(client.getRedirectUris().isEmpty());
        assertFalse(client.getAuthorizationGrantTypes().contains(AuthorizationGrantType.AUTHORIZATION_CODE));
        assertTrue(client.getAuthorizationGrantTypes().contains(AuthorizationGrantType.REFRESH_TOKEN));
        assertNull(keyStore.get(clientId));
    }

    @Test
    void undecodableClientId_returnsNull() {
        assertNull(recovery.recover("not-a-valid-client-id!!"));
    }
}
