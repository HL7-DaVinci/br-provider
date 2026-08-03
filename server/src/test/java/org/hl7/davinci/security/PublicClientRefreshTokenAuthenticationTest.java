package org.hl7.davinci.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2ClientAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;

class PublicClientRefreshTokenAuthenticationTest {

    private final MutableRegisteredClientRepository repository =
        new MutableRegisteredClientRepository();
    private final PublicClientRefreshTokenAuthentication authentication =
        new PublicClientRefreshTokenAuthentication(repository);

    private RegisteredClient savePublicClient() {
        RegisteredClient client = RegisteredClient.withId("id")
            .clientId("br-provider-smart-public")
            .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .redirectUri("http://localhost:3000/callback")
            .scope("openid")
            .build();
        repository.save(client);
        return client;
    }

    private static MockHttpServletRequest refreshRequest() {
        var request = new MockHttpServletRequest();
        request.setParameter("grant_type", "refresh_token");
        request.setParameter("refresh_token", "rt-value");
        request.setParameter("client_id", "br-provider-smart-public");
        return request;
    }

    @Test
    void convertsPublicClientRefreshRequest() {
        var token = assertInstanceOf(
            OAuth2ClientAuthenticationToken.class, authentication.convert(refreshRequest()));

        assertEquals("br-provider-smart-public", token.getPrincipal());
        assertEquals(ClientAuthenticationMethod.NONE, token.getClientAuthenticationMethod());
    }

    @Test
    void ignoresOtherGrantTypes() {
        var request = refreshRequest();
        request.setParameter("grant_type", "authorization_code");

        assertNull(authentication.convert(request));
    }

    @Test
    void ignoresRequestsCarryingClientCredentials() {
        var request = refreshRequest();
        request.setParameter("client_secret", "shh");

        assertNull(authentication.convert(request));
    }

    @Test
    void authenticatesRegisteredPublicClient() {
        RegisteredClient client = savePublicClient();

        var result = (OAuth2ClientAuthenticationToken) authentication.authenticate(
            new OAuth2ClientAuthenticationToken(
                client.getClientId(), ClientAuthenticationMethod.NONE, null, null));

        assertEquals(client, result.getRegisteredClient());
    }

    @Test
    void rejectsUnknownClient() {
        var token = new OAuth2ClientAuthenticationToken(
            "not-registered", ClientAuthenticationMethod.NONE, null, null);

        assertThrows(OAuth2AuthenticationException.class, () -> authentication.authenticate(token));
    }

    @Test
    void defersWhenClientAlreadyAuthenticated() {
        RegisteredClient client = savePublicClient();

        assertNull(authentication.authenticate(new OAuth2ClientAuthenticationToken(
            client, ClientAuthenticationMethod.NONE, null)));
    }
}
