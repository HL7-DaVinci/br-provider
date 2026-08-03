package org.hl7.davinci.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import static org.junit.jupiter.api.Assertions.*;

class StaticSmartClientRegistrationTest {

    private final MutableRegisteredClientRepository repository =
        new MutableRegisteredClientRepository();
    private final PasswordEncoder passwordEncoder =
        PasswordEncoderFactories.createDelegatingPasswordEncoder();

    private StaticSmartClientRegistration registration(SecurityProperties properties) {
        return new StaticSmartClientRegistration(repository, properties, passwordEncoder);
    }

    @Test
    void registersResolvedSpaCallbackAlongsideConfiguredRedirectUris() {
        var properties = new SecurityProperties();
        properties.setServerBaseUrl("https://provider.example.com");

        registration(properties).registerPublicClient();

        RegisteredClient client = repository.findByClientId(properties.getSmartPublicClientId());
        assertNotNull(client);
        assertTrue(client.getRedirectUris().contains("https://provider.example.com/callback"));
        assertTrue(client.getRedirectUris().contains("http://localhost:3000/callback"));
    }

    @Test
    void storesIntrospectionClientSecretEncoded() {
        var properties = new SecurityProperties();
        properties.setSmartIntrospectionClientId("introspection");
        properties.setSmartIntrospectionClientSecret("s3cret");

        registration(properties).registerIntrospectionClient();

        RegisteredClient client = repository.findByClientId("introspection");
        assertNotNull(client);
        assertNotEquals("s3cret", client.getClientSecret());
        assertTrue(passwordEncoder.matches("s3cret", client.getClientSecret()));
        assertTrue(client.getClientAuthenticationMethods()
            .contains(ClientAuthenticationMethod.CLIENT_SECRET_BASIC));
    }

    @Test
    void introspectionClientCannotMintTokens() {
        var properties = new SecurityProperties();
        properties.setSmartIntrospectionClientId("introspection");
        properties.setSmartIntrospectionClientSecret("s3cret");

        registration(properties).registerIntrospectionClient();

        RegisteredClient client = repository.findByClientId("introspection");
        assertFalse(client.getAuthorizationGrantTypes()
            .contains(AuthorizationGrantType.CLIENT_CREDENTIALS));
        assertTrue(client.getScopes().isEmpty());
    }

    @Test
    void skipsIntrospectionClientWithoutSecret() {
        var properties = new SecurityProperties();
        properties.setSmartIntrospectionClientId("introspection");
        properties.setSmartIntrospectionClientSecret("");

        registration(properties).registerIntrospectionClient();

        assertNull(repository.findByClientId("introspection"));
    }
}
