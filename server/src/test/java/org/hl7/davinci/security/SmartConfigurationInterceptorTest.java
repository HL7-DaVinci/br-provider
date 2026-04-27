package org.hl7.davinci.security;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.junit.jupiter.api.Assertions.*;

class SmartConfigurationInterceptorTest {

    @Test
    @SuppressWarnings("unchecked")
    void metadata_advertisesSmartLaunchCapabilitiesAndLocalOauthEndpoints() {
        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("http://localhost:8080");
        props.setSmartFhirBaseUrl("http://localhost:8080/fhir");
        SmartConfigurationInterceptor interceptor = new SmartConfigurationInterceptor(props);

        Map<String, Object> metadata = interceptor.metadata("http://localhost:8080");

        assertEquals("http://localhost:8080", metadata.get("issuer"));
        assertEquals("http://localhost:8080/oauth2/authorize", metadata.get("authorization_endpoint"));
        assertEquals("http://localhost:8080/oauth2/token", metadata.get("token_endpoint"));
        assertEquals(List.of("S256"), metadata.get("code_challenge_methods_supported"));

        List<String> capabilities = (List<String>) metadata.get("capabilities");
        assertTrue(capabilities.contains("launch-ehr"));
        assertTrue(capabilities.contains("launch-standalone"));
        assertTrue(capabilities.contains("client-public"));
        assertTrue(capabilities.contains("client-confidential-asymmetric"));
        assertTrue(capabilities.contains("context-ehr-patient"));
        assertTrue(capabilities.contains("context-ehr-encounter"));
        assertTrue(capabilities.contains("context-standalone-patient"));
        assertTrue(capabilities.contains("permission-patient"));
        assertTrue(capabilities.contains("permission-user"));

        List<String> authMethods = (List<String>) metadata.get("token_endpoint_auth_methods_supported");
        assertTrue(authMethods.contains("none"));
        assertTrue(authMethods.contains("private_key_jwt"));

        List<String> scopes = (List<String>) metadata.get("scopes_supported");
        assertTrue(scopes.contains("launch"));
        assertTrue(scopes.contains("launch/patient"));
        assertTrue(scopes.contains("patient/QuestionnaireResponse.cruds"));
        assertTrue(scopes.contains("user/ServiceRequest.rs"));
    }

    @Test
    void resolveServerRoot_prefersAllowedRequestHostHeaderOverConfiguredBaseUrl() {
        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("http://localhost:8080");
        props.setAllowedLocalHosts(List.of("localhost", "host.docker.internal"));
        SmartConfigurationInterceptor interceptor = new SmartConfigurationInterceptor(props);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setScheme("http");
        request.addHeader("Host", "host.docker.internal:8080");

        assertEquals("http://host.docker.internal:8080", interceptor.resolveServerRoot(request));
    }

    @Test
    void resolveServerRoot_fallsBackToConfiguredBaseUrlWhenHostHeaderMissing() {
        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("http://localhost:8080");
        SmartConfigurationInterceptor interceptor = new SmartConfigurationInterceptor(props);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setScheme("http");

        assertEquals("http://localhost:8080", interceptor.resolveServerRoot(request));
    }

    @Test
    void resolveServerRoot_fallsBackToConfiguredBaseUrlForUnallowedHostHeader() {
        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("http://localhost:8080");
        props.setAllowedLocalHosts(List.of("localhost"));
        SmartConfigurationInterceptor interceptor = new SmartConfigurationInterceptor(props);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setScheme("http");
        request.addHeader("Host", "evil.example.com:8080");

        assertEquals("http://localhost:8080", interceptor.resolveServerRoot(request));
    }
}
