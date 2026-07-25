package org.hl7.davinci.api;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.B2BTokenService;
import org.hl7.davinci.security.OutboundAuthService;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SpaAuthController;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class FhirProxyControllerTest {

    static final String LOCAL_SERVER = "http://fhir.test/fhir";

    SecurityProperties securityProperties;
    ServerProperties serverProperties;
    OutboundAuthService outboundAuth;
    FhirProxyController controller;

    @BeforeEach
    void setUp() {
        securityProperties = new SecurityProperties();
        securityProperties.setSslVerify(false);
        serverProperties = new ServerProperties(LOCAL_SERVER, null);
        outboundAuth = new OutboundAuthService(serverProperties);
        controller = new FhirProxyController(securityProperties, serverProperties, null, null, outboundAuth);
    }

    // --- Scheme validation (400) ---

    @Test
    void proxy_invalidUrlScheme_returns400() throws Exception {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        controller.proxy("file:///etc/passwd", false, "read", request, response);

        assertEquals(400, response.getStatus());
    }

    @Test
    void proxy_ftpScheme_returns400() throws Exception {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        controller.proxy("ftp://example.org/file", false, "read", request, response);

        assertEquals(400, response.getStatus());
    }

    @Test
    void proxy_noScheme_returns400() throws Exception {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();

        controller.proxy("not-a-url", false, "read", request, response);

        assertEquals(400, response.getStatus());
    }

    // --- SSRF protection (403 for untrusted URLs) ---

    @Test
    void proxy_untrustedUrl_returns403() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        controller.proxy("https://hapi.fhir.org/baseR4/Patient", false, "read", request, response);

        assertEquals(403, response.getStatus());
    }

    @Test
    void proxy_cloudMetadata_returns403() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        controller.proxy("http://169.254.169.254/latest/meta-data", false, "read", request, response);

        assertEquals(403, response.getStatus());
    }

    @Test
    void proxy_internalService_returns403() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        controller.proxy("http://localhost:6379/keys", false, "read", request, response);

        assertEquals(403, response.getStatus());
    }

    @Test
    void proxy_trustedUrlBoundary_prefixAttack_returns403() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        // http://localhost:8080/fhir is trusted, but fhir.evil.com should not match
        controller.proxy("http://localhost:8080/fhir.evil.com/Patient", false, "read", request, response);

        assertEquals(403, response.getStatus());
    }

    // --- Trusted URL proxying ---

    @Test
    void proxy_trustedUrl_noSession_proxiesWithoutAuth() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        try {
            controller.proxy(LOCAL_SERVER + "/metadata", false, "read", request, response);
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
            controller.proxy(LOCAL_SERVER + "/Patient", false, "read", request, response);
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
            controller.proxy(customServer + "/Patient", false, "read", request, response);
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
        var ctrl = new FhirProxyController(securityProperties, props, null, null, new OutboundAuthService(props));

        var request = new MockHttpServletRequest("GET", "/api/fhir-proxy");
        var response = new MockHttpServletResponse();

        try {
            ctrl.proxy("https://external.fhir.org/fhir/Patient", false, "read", request, response);
        } catch (Exception e) {
            // Connection refused is expected
        }

        assertNotEquals(403, response.getStatus());
    }

    // --- Payer B2B token failure handling ---

    @Test
    void payerRequestWithoutTokenIsRejectedWhenAuthEnabled() throws Exception {
        securityProperties.setEnableAuthentication(true);
        var payer = new ServerProperties.PayerServer();
        payer.setFhirUrl("https://payer.test/fhir");
        payer.setRequiresAuth(true);
        serverProperties.setPayerServers(List.of(payer));

        B2BTokenService b2bTokenService = mock(B2BTokenService.class);
        when(b2bTokenService.getTokenForServer(any(), any())).thenReturn(null);
        var ctrl = new FhirProxyController(securityProperties, serverProperties, b2bTokenService, null, outboundAuth);

        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);

        ctrl.proxy("https://payer.test/fhir/Patient", true, "read", request, response);

        verify(response).sendError(eq(502), contains("B2B token"));
    }

    @Test
    void payerRequestWithoutTokenForwardsWhenBypassHeaderPresent() throws Exception {
        securityProperties.setEnableAuthentication(true);
        var payer = new ServerProperties.PayerServer();
        payer.setFhirUrl("https://payer.test/fhir");
        payer.setRequiresAuth(true);
        serverProperties.setPayerServers(List.of(payer));

        B2BTokenService b2bTokenService = mock(B2BTokenService.class);
        when(b2bTokenService.getTokenForServer(any(), any())).thenReturn(null);
        var ctrl = new FhirProxyController(securityProperties, serverProperties, b2bTokenService, null, outboundAuth);

        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getHeader(securityProperties.getBypassHeader())).thenReturn("true");
        HttpServletResponse response = mock(HttpServletResponse.class);

        // Unresolvable target: the upstream call itself will fail, but that is a
        // separate, pre-existing failure path (generic 502) from the guard under
        // test here, which must not reject the request when bypass is requested.
        ctrl.proxy("https://payer.test/fhir/Patient", true, "read", request, response);

        verify(response, never()).sendError(eq(502), contains("B2B token"));
    }

    @Test
    void payerRequestOpenPayerSkipsB2BTokenAndGuard() throws Exception {
        securityProperties.setEnableAuthentication(true);
        var payer = new ServerProperties.PayerServer();
        payer.setFhirUrl("https://payer.test/fhir");
        payer.setRequiresAuth(false);
        serverProperties.setPayerServers(List.of(payer));

        B2BTokenService b2bTokenService = mock(B2BTokenService.class);
        var ctrl = new FhirProxyController(securityProperties, serverProperties, b2bTokenService, null, outboundAuth);

        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);

        ctrl.proxy("https://payer.test/fhir/Patient", true, "read", request, response);

        verify(response, never()).sendError(eq(502), contains("B2B token"));
        verify(b2bTokenService, never()).getTokenForServer(any(), any());
    }

    // --- Optimistic payer auth (mode UNKNOWN) ---

    static HttpServer startStub(java.util.function.Function<Integer, Integer> statusForAttempt,
            List<String> capturedAuthHeaders) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        AtomicInteger attempts = new AtomicInteger();
        server.createContext("/fhir", exchange -> {
            capturedAuthHeaders.add(exchange.getRequestHeaders().getFirst("Authorization"));
            int status = statusForAttempt.apply(attempts.incrementAndGet());
            byte[] body = "{\"resourceType\":\"Bundle\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        return server;
    }

    @Test
    void unknownPayer_upstream200_tokenless_forwardedOnce_andLearnedOpen() throws Exception {
        List<String> capturedAuthHeaders = new java.util.ArrayList<>();
        HttpServer stub = startStub(attempt -> 200, capturedAuthHeaders);
        try {
            String stubBase = "http://localhost:" + stub.getAddress().getPort();
            var request = new MockHttpServletRequest("POST", "/api/fhir-proxy");
            var session = request.getSession(true);
            session.setAttribute(SpaAuthController.SESSION_PAYER_FHIR_URL, stubBase);
            var response = new MockHttpServletResponse();

            B2BTokenService b2bTokenService = mock(B2BTokenService.class);
            var ctrl = new FhirProxyController(securityProperties, serverProperties, b2bTokenService, null, outboundAuth);

            ctrl.proxy(stubBase + "/fhir/Claim/$submit", true, "pas-submit", request, response);

            assertEquals(200, response.getStatus());
            assertEquals(1, capturedAuthHeaders.size());
            assertNull(capturedAuthHeaders.get(0));
            assertEquals(OutboundAuthService.Mode.OPEN, outboundAuth.modeFor(stubBase));
            verify(b2bTokenService, never()).getTokenForServer(any(), any());
        } finally {
            stub.stop(0);
        }
    }

    @Test
    void unknownPayer_upstream401ThenAuthed_retriesOnceWithBearer_andLearnsAuthRequired() throws Exception {
        List<String> capturedAuthHeaders = new java.util.ArrayList<>();
        HttpServer stub = startStub(attempt -> attempt == 1 ? 401 : 200, capturedAuthHeaders);
        try {
            String stubBase = "http://localhost:" + stub.getAddress().getPort();
            var request = new MockHttpServletRequest("POST", "/api/fhir-proxy");
            var session = request.getSession(true);
            session.setAttribute(SpaAuthController.SESSION_PAYER_FHIR_URL, stubBase);
            var response = new MockHttpServletResponse();

            B2BTokenService b2bTokenService = mock(B2BTokenService.class);
            when(b2bTokenService.getTokenForServer(eq(stubBase), any())).thenReturn("tok-123");
            var ctrl = new FhirProxyController(securityProperties, serverProperties, b2bTokenService, null, outboundAuth);

            ctrl.proxy(stubBase + "/fhir/Claim/$submit", true, "pas-submit", request, response);

            assertEquals(200, response.getStatus());
            assertEquals(2, capturedAuthHeaders.size());
            assertNull(capturedAuthHeaders.get(0));
            assertEquals("Bearer tok-123", capturedAuthHeaders.get(1));
            verify(b2bTokenService, times(1)).getTokenForServer(eq(stubBase), any());
            assertEquals(OutboundAuthService.Mode.UDAP_B2B, outboundAuth.modeFor(stubBase));
        } finally {
            stub.stop(0);
        }
    }

    @Test
    void unknownPayer_upstream401_noTokenObtainable_relays401() throws Exception {
        List<String> capturedAuthHeaders = new java.util.ArrayList<>();
        HttpServer stub = startStub(attempt -> 401, capturedAuthHeaders);
        try {
            String stubBase = "http://localhost:" + stub.getAddress().getPort();
            var request = new MockHttpServletRequest("POST", "/api/fhir-proxy");
            var session = request.getSession(true);
            session.setAttribute(SpaAuthController.SESSION_PAYER_FHIR_URL, stubBase);
            var response = new MockHttpServletResponse();

            B2BTokenService b2bTokenService = mock(B2BTokenService.class);
            when(b2bTokenService.getTokenForServer(eq(stubBase), any())).thenReturn(null);
            var ctrl = new FhirProxyController(securityProperties, serverProperties, b2bTokenService, null, outboundAuth);

            ctrl.proxy(stubBase + "/fhir/Claim/$submit", true, "pas-submit", request, response);

            assertEquals(401, response.getStatus());
            assertEquals(1, capturedAuthHeaders.size());
            assertEquals(OutboundAuthService.Mode.UDAP_B2B, outboundAuth.modeFor(stubBase));
        } finally {
            stub.stop(0);
        }
    }

    @Test
    void learnedAuthRequired_secondRequest_mintsUpfront() throws Exception {
        List<String> capturedAuthHeaders = new java.util.ArrayList<>();
        HttpServer stub = startStub(attempt -> 200, capturedAuthHeaders);
        try {
            String stubBase = "http://localhost:" + stub.getAddress().getPort();
            outboundAuth.recordAuthRequired(stubBase);

            var request = new MockHttpServletRequest("POST", "/api/fhir-proxy");
            var session = request.getSession(true);
            session.setAttribute(SpaAuthController.SESSION_PAYER_FHIR_URL, stubBase);
            var response = new MockHttpServletResponse();

            B2BTokenService b2bTokenService = mock(B2BTokenService.class);
            when(b2bTokenService.getTokenForServer(eq(stubBase), any())).thenReturn("tok-9");
            var ctrl = new FhirProxyController(securityProperties, serverProperties, b2bTokenService, null, outboundAuth);

            ctrl.proxy(stubBase + "/fhir/Claim/$submit", true, "pas-submit", request, response);

            assertEquals(200, response.getStatus());
            assertEquals(1, capturedAuthHeaders.size());
            assertEquals("Bearer tok-9", capturedAuthHeaders.get(0));
        } finally {
            stub.stop(0);
        }
    }

    @Test
    void openConfiguredPayer_bogusOp_returns400() throws Exception {
        var payer = new ServerProperties.PayerServer();
        payer.setFhirUrl("https://payer.test/fhir");
        payer.setRequiresAuth(false);
        serverProperties.setPayerServers(List.of(payer));

        B2BTokenService b2bTokenService = mock(B2BTokenService.class);
        var ctrl = new FhirProxyController(securityProperties, serverProperties, b2bTokenService, null, outboundAuth);

        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);

        ctrl.proxy("https://payer.test/fhir/Patient", true, "nonsense", request, response);

        verify(response).sendError(eq(400), any());
        verify(b2bTokenService, never()).getTokenForServer(any(), any());
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
