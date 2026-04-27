package org.hl7.davinci.security;

import java.time.Instant;
import java.util.Map;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.endpoint.OAuth2AccessTokenResponse;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AccessTokenAuthenticationContext;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AccessTokenAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import static org.junit.jupiter.api.Assertions.*;

class SmartTokenResponseCustomizerTest {

    @Test
    void smartContextClaimsAreMergedWithExistingOidcTokenResponseParameters() throws Exception {
        String tokenValue = jwt(Map.of("patient", "patient-1"));
        OAuth2AccessToken accessToken = new OAuth2AccessToken(
            OAuth2AccessToken.TokenType.BEARER,
            tokenValue,
            Instant.now(),
            Instant.now().plusSeconds(300)
        );
        OAuth2AccessTokenAuthenticationToken authentication =
            new OAuth2AccessTokenAuthenticationToken(
                registeredClient(),
                new TestingAuthenticationToken("user", "password"),
                accessToken,
                null,
                Map.of("id_token", "oidc-token")
            );
        OAuth2AccessTokenResponse.Builder responseBuilder = OAuth2AccessTokenResponse
            .withToken(tokenValue)
            .tokenType(OAuth2AccessToken.TokenType.BEARER)
            .additionalParameters(Map.of("id_token", "oidc-token"));
        OAuth2AccessTokenAuthenticationContext context = OAuth2AccessTokenAuthenticationContext
            .with(authentication)
            .accessTokenResponse(responseBuilder)
            .build();

        new SmartTokenResponseCustomizer().accept(context);

        Map<String, Object> additionalParameters = context.getAccessTokenResponse()
            .build()
            .getAdditionalParameters();
        assertEquals("oidc-token", additionalParameters.get("id_token"));
        assertEquals("patient-1", additionalParameters.get("patient"));
    }

    private static String jwt(Map<String, Object> claims) throws Exception {
        JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder();
        claims.forEach(builder::claim);
        SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), builder.build());
        jwt.sign(new MACSigner("01234567890123456789012345678901"));
        return jwt.serialize();
    }

    private static RegisteredClient registeredClient() {
        return RegisteredClient.withId("client-id")
            .clientId("client")
            .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .redirectUri("http://localhost:3000/callback")
            .scope("openid")
            .build();
    }
}
