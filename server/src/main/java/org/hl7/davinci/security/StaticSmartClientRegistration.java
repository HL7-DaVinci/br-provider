package org.hl7.davinci.security;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import jakarta.annotation.PostConstruct;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.stereotype.Component;

@Component
public class StaticSmartClientRegistration {

    private final MutableRegisteredClientRepository registeredClientRepository;
    private final SecurityProperties securityProperties;

    public StaticSmartClientRegistration(
            MutableRegisteredClientRepository registeredClientRepository,
            SecurityProperties securityProperties) {
        this.registeredClientRepository = registeredClientRepository;
        this.securityProperties = securityProperties;
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
            .redirectUris(uris -> uris.addAll(securityProperties.getSmartPublicRedirectUris()))
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
}
