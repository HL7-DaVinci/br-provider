package org.hl7.davinci.security;

import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SmartClientDiscoveryServiceTest {

    @Test
    void parsesRequiredAndConditionalFields() throws Exception {
        String json = """
            {"authorization_endpoint":"https://ehr.example.com/oauth/authorize",
             "token_endpoint":"https://ehr.example.com/oauth/token",
             "capabilities":["launch-standalone","client-public","permission-v2"],
             "grant_types_supported":["authorization_code","client_credentials"],
             "code_challenge_methods_supported":["S256"],
             "token_endpoint_auth_methods_supported":["none","private_key_jwt"],
             "token_endpoint_auth_signing_alg_values_supported":["RS384","ES384"],
             "issuer":"https://ehr.example.com",
             "jwks_uri":"https://ehr.example.com/jwks"}""";
        SmartClientDiscoveryService.SmartConfiguration config =
            SmartClientDiscoveryService.parse(json, "https://ehr.example.com/fhir");
        assertEquals("https://ehr.example.com/oauth/token", config.tokenEndpoint());
        assertEquals("https://ehr.example.com/oauth/authorize", config.authorizationEndpoint());
        assertTrue(config.capabilities().contains("launch-standalone"));
        assertEquals(List.of("RS384", "ES384"), config.tokenEndpointAuthSigningAlgs());
    }

    @Test
    void resolvesRelativeEndpointsAgainstFhirBase() throws Exception {
        String json = """
            {"authorization_endpoint":"/oauth/authorize",
             "token_endpoint":"/oauth/token",
             "capabilities":[],"grant_types_supported":["authorization_code"],
             "code_challenge_methods_supported":["S256"]}""";
        SmartClientDiscoveryService.SmartConfiguration config =
            SmartClientDiscoveryService.parse(json, "https://ehr.example.com/r4/fhir");
        assertEquals("https://ehr.example.com/oauth/token", config.tokenEndpoint());
    }

    @Test
    void missingTokenEndpointThrows() {
        assertThrows(IllegalStateException.class,
            () -> SmartClientDiscoveryService.parse("{\"capabilities\":[]}", "https://x/fhir"));
    }

    @Test
    void discoverRejectsValidatorBlockedBaseUrl() {
        OutboundTargetValidator validator = new OutboundTargetValidator(new SecurityProperties());
        SmartClientDiscoveryService service =
            new SmartClientDiscoveryService(new SecurityProperties(), validator);

        assertThrows(IllegalArgumentException.class, () -> service.discover("http://10.0.0.1/fhir"));
    }
}
