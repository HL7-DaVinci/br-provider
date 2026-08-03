package org.hl7.davinci.security;

import java.time.Instant;
import java.util.Base64;
import java.util.Set;
import org.springframework.lang.Nullable;
import org.springframework.security.crypto.keygen.Base64StringKeyGenerator;
import org.springframework.security.crypto.keygen.StringKeyGenerator;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.OAuth2RefreshToken;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2ClientAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenGenerator;

/**
 * Issues refresh tokens, including to public clients that were granted a SMART
 * refresh scope. Spring's default generator never issues one to a public client
 * on the authorization_code grant, but SMART App Launch requires a refresh token
 * whenever offline_access or online_access is granted, and SMART apps are
 * commonly public clients.
 */
public class SmartRefreshTokenGenerator implements OAuth2TokenGenerator<OAuth2RefreshToken> {

    static final Set<String> REFRESH_SCOPES = Set.of("offline_access", "online_access");

    private final StringKeyGenerator refreshTokenGenerator =
        new Base64StringKeyGenerator(Base64.getUrlEncoder().withoutPadding(), 96);

    @Nullable
    @Override
    public OAuth2RefreshToken generate(OAuth2TokenContext context) {
        if (!OAuth2TokenType.REFRESH_TOKEN.equals(context.getTokenType())) {
            return null;
        }
        if (isPublicClientForAuthorizationCodeGrant(context) && !hasRefreshScope(context)) {
            return null;
        }

        Instant issuedAt = Instant.now();
        Instant expiresAt = issuedAt.plus(
            context.getRegisteredClient().getTokenSettings().getRefreshTokenTimeToLive());
        return new OAuth2RefreshToken(refreshTokenGenerator.generateKey(), issuedAt, expiresAt);
    }

    private static boolean hasRefreshScope(OAuth2TokenContext context) {
        Set<String> scopes = context.getAuthorizedScopes();
        return scopes != null && scopes.stream().anyMatch(REFRESH_SCOPES::contains);
    }

    private static boolean isPublicClientForAuthorizationCodeGrant(OAuth2TokenContext context) {
        if (AuthorizationGrantType.AUTHORIZATION_CODE.equals(context.getAuthorizationGrantType())
                && context.getAuthorizationGrant() != null
                && context.getAuthorizationGrant().getPrincipal()
                    instanceof OAuth2ClientAuthenticationToken clientPrincipal) {
            return ClientAuthenticationMethod.NONE.equals(clientPrincipal.getClientAuthenticationMethod());
        }
        return false;
    }
}
