package org.hl7.davinci.security;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2ClientAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.token.DefaultOAuth2TokenContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenContext;

class SmartRefreshTokenGeneratorTest {

    private final SmartRefreshTokenGenerator generator = new SmartRefreshTokenGenerator();

    private static RegisteredClient publicClient() {
        return RegisteredClient.withId("id")
            .clientId("br-provider-smart-public")
            .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .redirectUri("http://localhost:3000/callback")
            .scope("openid")
            .build();
    }

    private static OAuth2TokenContext context(RegisteredClient client, Set<String> scopes) {
        var clientPrincipal = new OAuth2ClientAuthenticationToken(
            client, ClientAuthenticationMethod.NONE, null);
        var grant = new OAuth2AuthorizationCodeAuthenticationToken(
            "code", clientPrincipal, "http://localhost:3000/callback", null);
        return DefaultOAuth2TokenContext.builder()
            .registeredClient(client)
            .tokenType(OAuth2TokenType.REFRESH_TOKEN)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrant(grant)
            .authorizedScopes(scopes)
            .build();
    }

    @Test
    void issuesRefreshTokenToPublicClientWithOfflineAccess() {
        var token = generator.generate(context(publicClient(), Set.of("openid", "offline_access")));

        assertNotNull(token);
    }

    @Test
    void issuesRefreshTokenToPublicClientWithOnlineAccess() {
        var token = generator.generate(context(publicClient(), Set.of("online_access")));

        assertNotNull(token);
    }

    @Test
    void withholdsRefreshTokenFromPublicClientWithoutRefreshScope() {
        var token = generator.generate(context(publicClient(), Set.of("openid", "patient/*.rs")));

        assertNull(token);
    }

    @Test
    void ignoresNonRefreshTokenRequests() {
        var client = publicClient();
        var context = DefaultOAuth2TokenContext.builder()
            .registeredClient(client)
            .tokenType(OAuth2TokenType.ACCESS_TOKEN)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizedScopes(Set.of("offline_access"))
            .build();

        assertNull(generator.generate(context));
    }
}
