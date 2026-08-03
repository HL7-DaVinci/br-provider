package org.hl7.davinci.security;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import jakarta.annotation.PostConstruct;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.stereotype.Component;

@Component
public class StaticSmartClientRegistration {

    private final MutableRegisteredClientRepository registeredClientRepository;
    private final SecurityProperties securityProperties;
    private final PasswordEncoder passwordEncoder;

    public StaticSmartClientRegistration(
            MutableRegisteredClientRepository registeredClientRepository,
            SecurityProperties securityProperties,
            PasswordEncoder passwordEncoder) {
        this.registeredClientRepository = registeredClientRepository;
        this.securityProperties = securityProperties;
        this.passwordEncoder = passwordEncoder;
    }

    @PostConstruct
    public void registerPublicClient() {
        String clientId = securityProperties.getSmartPublicClientId();
        if (clientId == null || clientId.isBlank()
                || registeredClientRepository.findByClientId(clientId) != null) {
            return;
        }

        RegisteredClient client = RegisteredClient
            .withId(UUID.nameUUIDFromBytes(
                ("smart-public:" + clientId).getBytes(StandardCharsets.UTF_8)).toString())
            .clientId(clientId)
            .clientName(securityProperties.getSmartPublicClientName())
            .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .redirectUris(uris -> {
                uris.addAll(securityProperties.getSmartPublicRedirectUris());
                // The SPA callback this deployment resolves at runtime.
                uris.add(UdapClientRegistration.buildRedirectUri(securityProperties));
            })
            .scopes(scopes -> scopes.addAll(SmartScopes.supportedScopes()))
            .clientSettings(ClientSettings.builder()
                .requireProofKey(true)
                .requireAuthorizationConsent(false)
                .build())
            .tokenSettings(TokenSettings.builder()
                .accessTokenTimeToLive(Duration.ofHours(1))
                .refreshTokenTimeToLive(Duration.ofHours(8))
                .reuseRefreshTokens(false)
                .build())
            .build();

        registeredClientRepository.save(client);
    }

    /**
     * Registers a client that can authenticate to the token introspection
     * endpoint, which RFC 7662 requires to be protected. Introspection callers
     * are resource servers, so a shared secret with HTTP Basic is enough.
     */
    @PostConstruct
    public void registerIntrospectionClient() {
        String clientId = securityProperties.getSmartIntrospectionClientId();
        String clientSecret = securityProperties.getSmartIntrospectionClientSecret();
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank()
                || registeredClientRepository.findByClientId(clientId) != null) {
            return;
        }

        RegisteredClient client = RegisteredClient
            .withId(UUID.nameUUIDFromBytes(
                ("smart-introspection:" + clientId).getBytes(StandardCharsets.UTF_8)).toString())
            .clientId(clientId)
            .clientSecret(passwordEncoder.encode(clientSecret))
            .clientName("Token Introspection Client")
            .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
            .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
            // A registration needs a grant type, and this client must not mint
            // FHIR tokens. It can never hold a refresh token, so this grant is
            // unusable at the token endpoint while client authentication still works.
            .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
            .clientSettings(ClientSettings.builder()
                .requireAuthorizationConsent(false)
                .build())
            .build();

        registeredClientRepository.save(client);
    }

    @PostConstruct
    public void registerBackendServicesClient() {
        String clientId = securityProperties.getSmartBackendClientId();
        String jwksUrl = securityProperties.getSmartBackendClientJwksUrl();
        if (clientId == null || clientId.isBlank() || jwksUrl == null || jwksUrl.isBlank()
                || registeredClientRepository.findByClientId(clientId) != null) {
            return;
        }

        RegisteredClient client = RegisteredClient
            .withId(UUID.nameUUIDFromBytes(
                ("smart-backend:" + clientId).getBytes(StandardCharsets.UTF_8)).toString())
            .clientId(clientId)
            .clientName("SMART Backend Services Test Client")
            .clientAuthenticationMethod(ClientAuthenticationMethod.PRIVATE_KEY_JWT)
            .authorizationGrantType(AuthorizationGrantType.CLIENT_CREDENTIALS)
            .scopes(scopes -> SmartScopes.supportedScopes().stream()
                .filter(s -> s.startsWith("system/"))
                .forEach(scopes::add))
            .clientSettings(ClientSettings.builder()
                .jwkSetUrl(jwksUrl)
                .tokenEndpointAuthenticationSigningAlgorithm(SignatureAlgorithm.RS384)
                .requireAuthorizationConsent(false)
                .build())
            .tokenSettings(TokenSettings.builder()
                .accessTokenTimeToLive(Duration.ofHours(1))
                .build())
            .build();

        registeredClientRepository.save(client);
    }
}
