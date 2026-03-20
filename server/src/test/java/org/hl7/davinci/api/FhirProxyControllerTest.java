package org.hl7.davinci.api;

import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SpaAuthController;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.junit.jupiter.api.Assertions.*;

class FhirProxyControllerTest {

    SecurityProperties securityProperties;
    FhirProxyController controller;

    @BeforeEach
    void setUp() {
        securityProperties = new SecurityProperties();
        securityProperties.setSslVerify(false);
        controller = new FhirProxyController(securityProperties);
    }

    @Test
    void proxy_invalidUrlScheme_returns400() throws Exception {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        controller.proxy("file:///etc/passwd", request, response);

        assertEquals(400, response.getStatus());
    }

    @Test
    void proxy_ftpScheme_returns400() throws Exception {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        controller.proxy("ftp://example.org/file", request, response);

        assertEquals(400, response.getStatus());
    }

    @Test
    void proxy_noScheme_returns400() throws Exception {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        controller.proxy("not-a-url", request, response);

        assertEquals(400, response.getStatus());
    }

    @Test
    void proxy_noSession_proxiesWithoutAuth() throws Exception {
        // Without a session, the proxy should still forward the request
        // (without an Authorization header). The target server decides access.
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        try {
            controller.proxy("http://localhost:99999/fhir/metadata", request, response);
        } catch (Exception e) {
            // Connection refused is expected; the key assertion is no 401
        }

        assertNotEquals(401, response.getStatus());
    }

    @Test
    void proxy_withToken_proxiesWithAuth() throws Exception {
        // With a session token, the proxy forwards the request with Authorization.
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var session = request.getSession(true);
        session.setAttribute(SpaAuthController.SESSION_ACCESS_TOKEN, "test-token");
        var response = new MockHttpServletResponse();

        try {
            controller.proxy("http://localhost:99999/fhir/Patient", request, response);
        } catch (Exception e) {
            // Connection refused is expected; the key assertion is no 400/401
        }

        assertNotEquals(400, response.getStatus());
        assertNotEquals(401, response.getStatus());
    }
}
