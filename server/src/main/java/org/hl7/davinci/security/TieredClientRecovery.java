package org.hl7.davinci.security;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Reconstructs a UDAP Tiered OAuth RegisteredClient from its client_id alone,
 * for when a provider restart clears the in-memory client store but the
 * authorization server (the RI) still holds a client_id issued by an earlier
 * DCR. The client's signing key is not known yet at this point; it is learned
 * from the RI's own client_assertion on the /oauth2/token request that
 * follows, by {@link UdapClientAssertionKeyFilter}.
 */
@Component
class TieredClientRecovery {

    private static final Logger logger = LoggerFactory.getLogger(TieredClientRecovery.class);
    private static final String DEFAULT_SCOPES = "udap openid email profile";

    private final SecurityProperties securityProperties;
    private final MutableRegisteredClientRepository registeredClientRepository;

    TieredClientRecovery(
            SecurityProperties securityProperties,
            MutableRegisteredClientRepository registeredClientRepository) {
        this.securityProperties = securityProperties;
        this.registeredClientRepository = registeredClientRepository;
    }

    /** Returns the recovered client, or null when the client_id is not a tiered client id. */
    RegisteredClient recover(String clientId) {
        Optional<String> issuerOpt = TieredClientIds.decode(clientId);
        if (issuerOpt.isEmpty()) {
            return null;
        }
        String issuer = issuerOpt.get();

        String redirectUri = recoverableRedirectUri(issuer);
        List<String> scopes = requestedScopes();

        RegisteredClient.Builder builder = RegisteredClient.withId(clientId)
            .clientId(clientId)
            .clientName(issuer)
            .clientAuthenticationMethod(ClientAuthenticationMethod.PRIVATE_KEY_JWT)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .scopes(s -> s.addAll(scopes))
            .clientSettings(ClientSettings.builder()
                .requireProofKey(false)
                .jwkSetUrl(securityProperties.getServerBaseUrl() + "/oauth2/udap-jwks?client_id=" + clientId)
                .tokenEndpointAuthenticationSigningAlgorithm(SignatureAlgorithm.RS256)
                .build());
        if (redirectUri != null) {
            // RegisteredClient rejects the authorization_code grant with no redirect
            // URI, so only add it when a trustworthy one was recovered. A refresh-only
            // client still lets a pending token request (not an authorize redirect)
            // through.
            builder.authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE);
            builder.redirectUri(redirectUri);
        }

        RegisteredClient client = builder.build();
        registeredClientRepository.saveRecovered(client, issuer);
        logger.info("Recovered tiered client {} for issuer {}", clientId, issuer);
        return client;
    }

    private String recoverableRedirectUri(String issuer) {
        HttpServletRequest request = currentRequest();
        if (request == null) {
            return null;
        }
        String redirectUri = request.getParameter("redirect_uri");
        return (redirectUri != null && sameOrigin(redirectUri, issuer)) ? redirectUri : null;
    }

    private List<String> requestedScopes() {
        HttpServletRequest request = currentRequest();
        String scope = request != null ? request.getParameter("scope") : null;
        return scope != null ? Arrays.asList(scope.split(" ")) : Arrays.asList(DEFAULT_SCOPES.split(" "));
    }

    private static HttpServletRequest currentRequest() {
        var attributes = RequestContextHolder.getRequestAttributes();
        return attributes instanceof ServletRequestAttributes servletAttributes
            ? servletAttributes.getRequest()
            : null;
    }

    /** True when redirectUri is absolute and shares scheme, host and port with issuer. */
    private static boolean sameOrigin(String redirectUri, String issuer) {
        try {
            URI redirect = new URI(redirectUri);
            URI issuerUri = new URI(issuer);
            return redirect.isAbsolute()
                && redirect.getPort() == issuerUri.getPort()
                && redirect.getScheme() != null
                && redirect.getScheme().equalsIgnoreCase(issuerUri.getScheme())
                && redirect.getHost() != null
                && redirect.getHost().equalsIgnoreCase(issuerUri.getHost());
        } catch (URISyntaxException e) {
            return false;
        }
    }
}
