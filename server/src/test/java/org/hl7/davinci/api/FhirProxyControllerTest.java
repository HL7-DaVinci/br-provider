package org.hl7.davinci.api;

import java.util.List;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SpaAuthController;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.junit.jupiter.api.Assertions.*;

class FhirProxyControllerTest {

    static final String LOCAL_SERVER = "http://fhir.test/fhir";

    SecurityProperties securityProperties;
    ServerProperties serverProperties;
    FhirProxyController controller;

    @BeforeEach
    void setUp() {
        securityProperties = new SecurityProperties();
        securityProperties.setSslVerify(false);
        serverProperties = new ServerProperties(LOCAL_SERVER, null);
        controller = new FhirProxyController(securityProperties, serverProperties, null, null);
    }

    // --- Scheme validation (400) ---

    @Test
    void proxy_invalidUrlScheme_returns400() throws Exception {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        controller.proxy("file:///etc/passwd", false, request, response);

        assertEquals(400, response.getStatus());
    }

    @Test
    void proxy_ftpScheme_returns400() throws Exception {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        controller.proxy("ftp://example.org/file", false, request, response);

        assertEquals(400, response.getStatus());
    }

    @Test
    void proxy_noScheme_returns400() throws Exception {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        controller.proxy("not-a-url", false, request, response);

        assertEquals(400, response.getStatus());
    }

    // --- SSRF protection (403 for untrusted URLs) ---

    @Test
    void proxy_untrustedUrl_returns403() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        controller.proxy("https://hapi.fhir.org/baseR4/Patient", false, request, response);

        assertEquals(403, response.getStatus());
    }

    @Test
    void proxy_cloudMetadata_returns403() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        controller.proxy("http://169.254.169.254/latest/meta-data", false, request, response);

        assertEquals(403, response.getStatus());
    }

    @Test
    void proxy_internalService_returns403() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        controller.proxy("http://localhost:6379/keys", false, request, response);

        assertEquals(403, response.getStatus());
    }

    @Test
    void proxy_trustedUrlBoundary_prefixAttack_returns403() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        // http://localhost:8080/fhir is trusted, but fhir.evil.com should not match
        controller.proxy("http://localhost:8080/fhir.evil.com/Patient", false, request, response);

        assertEquals(403, response.getStatus());
    }

    // --- Trusted URL proxying ---

    @Test
    void proxy_trustedUrl_noSession_proxiesWithoutAuth() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        try {
            controller.proxy(LOCAL_SERVER + "/metadata", false, request, response);
        } catch (Exception e) {
            // Connection refused is expected; the key assertion is no 401/403
        }

        assertNotEquals(401, response.getStatus());
        assertNotEquals(403, response.getStatus());
    }

    @Test
    void proxy_trustedUrl_withToken_proxiesWithAuth() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var session = request.getSession(true);
        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "test-token", null);
        var response = new MockHttpServletResponse();

        try {
            controller.proxy(LOCAL_SERVER + "/Patient", false, request, response);
        } catch (Exception e) {
            // Connection refused is expected
        }

        assertNotEquals(400, response.getStatus());
        assertNotEquals(401, response.getStatus());
        assertNotEquals(403, response.getStatus());
    }

    // --- Dynamic registered servers (Phase 2 infrastructure) ---

    @Test
    void proxy_dynamicRegisteredServer_allowed() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var session = request.getSession(true);

        String customServer = "https://custom.fhir.org/fhir";
        SpaAuthController.storeServerToken(session, customServer, "custom-token", null);

        var response = new MockHttpServletResponse();
        try {
            controller.proxy(customServer + "/Patient", false, request, response);
        } catch (Exception e) {
            // Connection refused is expected
        }

        assertNotEquals(403, response.getStatus());
    }

    // --- Single-server token matching ---

    @Test
    void getTokenForServer_matchesAuthenticatedServer() {
        var request = new MockHttpServletRequest();
        var session = request.getSession(true);

        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "local-token", null);

        assertEquals("local-token",
            SpaAuthController.getTokenForServer(session, LOCAL_SERVER + "/Patient"));
        assertNull(
            SpaAuthController.getTokenForServer(session, "https://other.fhir.org/fhir/Patient"));
    }

    @Test
    void getTokenForServer_lastStoredServerWins() {
        var request = new MockHttpServletRequest();
        var session = request.getSession(true);

        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "local-token", null);
        SpaAuthController.storeServerToken(session, "https://other.fhir.org/fhir", "other-token", null);

        // Single-server model: last storeServerToken call overwrites
        assertEquals("other-token",
            SpaAuthController.getTokenForServer(session, "https://other.fhir.org/fhir/Patient"));
        assertNull(
            SpaAuthController.getTokenForServer(session, LOCAL_SERVER + "/Patient"));
    }

    @Test
    void getTokenForServer_nullSession_returnsNull() {
        assertNull(SpaAuthController.getTokenForServer(null, LOCAL_SERVER + "/Patient"));
    }

    // --- Configured trusted servers from JSON ---

    @Test
    void proxy_configuredExternalServer_allowed() throws Exception {
        var external = new ServerProperties.ProviderServer();
        external.setName("External");
        external.setUrl("https://external.fhir.org/fhir");
        var props = new ServerProperties(LOCAL_SERVER, List.of(external));
        var ctrl = new FhirProxyController(securityProperties, props, null, null);

        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        try {
            ctrl.proxy("https://external.fhir.org/fhir/Patient", false, request, response);
        } catch (Exception e) {
            // Connection refused is expected
        }

        assertNotEquals(403, response.getStatus());
    }

    @Test
    void shouldRelayResponseHeader_blocksSetCookieHeaders() {
        assertFalse(FhirProxyController.shouldRelayResponseHeader("set-cookie"));
        assertFalse(FhirProxyController.shouldRelayResponseHeader("Set-Cookie"));
        assertFalse(FhirProxyController.shouldRelayResponseHeader("set-cookie2"));
    }

    @Test
    void shouldRelayResponseHeader_allowsRegularResponseHeaders() {
        assertTrue(FhirProxyController.shouldRelayResponseHeader("content-type"));
        assertTrue(FhirProxyController.shouldRelayResponseHeader("etag"));
    }
}
