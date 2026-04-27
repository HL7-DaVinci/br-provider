package org.hl7.davinci.security;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationContext;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationException;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import static org.junit.jupiter.api.Assertions.*;

class SmartAuthorizationRequestValidatorTest {

    private SecurityProperties props;
    private SmartLaunchService launchService;
    private SmartAuthorizationRequestValidator validator;
    private RegisteredClient registeredClient;

    @BeforeEach
    void setUp() {
        props = new SecurityProperties();
        props.setSmartFhirBaseUrl("http://localhost:8080/fhir");
        launchService = new SmartLaunchService();
        validator = new SmartAuthorizationRequestValidator(props, launchService);
        registeredClient = RegisteredClient.withId("client-id")
            .clientId("client")
            .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .redirectUri("http://localhost:3000/callback")
            .scope("launch")
            .scope("patient/Patient.rs")
            .build();
    }

    @Test
    void nonSmartAuthorizationRequest_isIgnored() {
        OAuth2AuthorizationCodeRequestAuthenticationToken request = request(
            Set.of("openid"),
            Map.of()
        );

        assertDoesNotThrow(() -> validator.accept(context(request)));
    }

    @Test
    void smartAuthorizationRequest_requiresAud() {
        OAuth2AuthorizationCodeRequestAuthenticationToken request = request(
            Set.of("patient/Patient.rs"),
            Map.of()
        );

        assertThrows(
            OAuth2AuthorizationCodeRequestAuthenticationException.class,
            () -> validator.accept(context(request))
        );
    }

    @Test
    void ehrLaunchRequest_requiresValidLaunchToken() {
        OAuth2AuthorizationCodeRequestAuthenticationToken request = request(
            Set.of("launch", "patient/Patient.rs"),
            Map.of("aud", "http://localhost:8080/fhir", "launch", "missing")
        );

        assertThrows(
            OAuth2AuthorizationCodeRequestAuthenticationException.class,
            () -> validator.accept(context(request))
        );
    }

    @Test
    void audWithAllowedLocalHostIsAccepted() {
        props.setAllowedLocalHosts(List.of("localhost", "127.0.0.1", "host.docker.internal"));
        String launch = launchService.createLaunchContext(
            "patient-1", "encounter-1", List.of(), null, null, null
        );
        OAuth2AuthorizationCodeRequestAuthenticationToken request = request(
            Set.of("launch", "patient/Patient.rs"),
            Map.of("aud", "http://host.docker.internal:8080/fhir", "launch", launch)
        );

        assertDoesNotThrow(() -> validator.accept(context(request)));
    }

    @Test
    void audWithUnknownHostIsRejected() {
        props.setAllowedLocalHosts(List.of("localhost", "127.0.0.1"));
        OAuth2AuthorizationCodeRequestAuthenticationToken request = request(
            Set.of("launch", "patient/Patient.rs"),
            Map.of("aud", "http://evil.example.com:8080/fhir", "launch", "launch-id")
        );

        assertThrows(
            OAuth2AuthorizationCodeRequestAuthenticationException.class,
            () -> validator.accept(context(request))
        );
    }

    @Test
    void audWithMismatchedPortIsRejected() {
        props.setAllowedLocalHosts(List.of("localhost", "host.docker.internal"));
        OAuth2AuthorizationCodeRequestAuthenticationToken request = request(
            Set.of("launch", "patient/Patient.rs"),
            Map.of("aud", "http://host.docker.internal:9999/fhir", "launch", "launch-id")
        );

        assertThrows(
            OAuth2AuthorizationCodeRequestAuthenticationException.class,
            () -> validator.accept(context(request))
        );
    }

    @Test
    void validEhrLaunchRequestPasses() {
        String launch = launchService.createLaunchContext(
            "patient-1",
            "encounter-1",
            List.of("Coverage/cov-1"),
            null,
            null,
            null
        );
        OAuth2AuthorizationCodeRequestAuthenticationToken request = request(
            Set.of("launch", "patient/Patient.rs"),
            Map.of("aud", "http://localhost:8080/fhir", "launch", launch)
        );

        assertDoesNotThrow(() -> validator.accept(context(request)));
    }

    private OAuth2AuthorizationCodeRequestAuthenticationContext context(
            OAuth2AuthorizationCodeRequestAuthenticationToken request) {
        return OAuth2AuthorizationCodeRequestAuthenticationContext.with(request)
            .registeredClient(registeredClient)
            .build();
    }

    private static OAuth2AuthorizationCodeRequestAuthenticationToken request(
            Set<String> scopes,
            Map<String, Object> additionalParameters) {
        TestingAuthenticationToken principal = new TestingAuthenticationToken("user", "password");
        principal.setAuthenticated(true);
        return new OAuth2AuthorizationCodeRequestAuthenticationToken(
            "http://localhost:8080/oauth2/authorize",
            "client",
            principal,
            "http://localhost:3000/callback",
            "state",
            scopes,
            additionalParameters
        );
    }
}
