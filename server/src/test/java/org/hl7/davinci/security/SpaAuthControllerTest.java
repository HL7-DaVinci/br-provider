package org.hl7.davinci.security;

import java.time.Instant;
import java.util.Map;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.junit.jupiter.api.Assertions.*;

class SpaAuthControllerTest {

    private static final String TEST_CERT_PATH = "src/test/resources/test-cert.pfx";
    private static final String TEST_CERT_PASSWORD = "testpass";

    StubUdapClientRegistration udapClient;
    CertificateHolder certificateHolder;
    SecurityProperties securityProperties;
    SpaAuthController controller;

    @BeforeEach
    void setUp() throws Exception {
        securityProperties = new SecurityProperties();
        securityProperties.setServerBaseUrl("http://localhost:8080");
        certificateHolder = testCertificateHolder();
        udapClient = new StubUdapClientRegistration(securityProperties, certificateHolder);
        controller = new SpaAuthController(udapClient, certificateHolder, securityProperties);
    }

    @Test
    void login_redirectsToAuthorizeEndpoint() throws Exception {
        ResponseEntity<Void> response = controller.login();

        assertEquals(302, response.getStatusCode().value());
        String location = response.getHeaders().getLocation().toString();
        assertTrue(location.startsWith("https://localhost:5001/connect/authorize"));
        assertTrue(location.contains("client_id=test-client-id"));
        assertTrue(location.contains("redirect_uri=http://localhost:3000/callback"));
        assertTrue(location.contains("code_challenge="));
        assertTrue(location.contains("code_challenge_method=S256"));
        assertTrue(location.contains("state="));

        // Verify state was stored in pending flows
        assertEquals(1, controller.getPendingFlows().size());
    }

    @Test
    void token_missingCode_returns400() {
        var request = new MockHttpServletRequest();
        Map<String, String> body = Map.of("state", "some-state");

        ResponseEntity<Map<String, Object>> response = controller.exchangeToken(body, request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("invalid_request", response.getBody().get("error"));
    }

    @Test
    void token_missingState_returns400() {
        var request = new MockHttpServletRequest();
        Map<String, String> body = Map.of("code", "some-code");

        ResponseEntity<Map<String, Object>> response = controller.exchangeToken(body, request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("invalid_request", response.getBody().get("error"));
    }

    @Test
    void token_unknownState_returns400() {
        var request = new MockHttpServletRequest();
        Map<String, String> body = Map.of("code", "some-code", "state", "unknown-state");

        ResponseEntity<Map<String, Object>> response = controller.exchangeToken(body, request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("invalid_state", response.getBody().get("error"));
    }

    @Test
    void token_expiredState_returns400() {
        var request = new MockHttpServletRequest();
        String state = "expired-state";
        controller.getPendingFlows().put(state,
            new SpaAuthController.PendingFlow("verifier", "http://localhost:3000/callback",
                Instant.now().minusSeconds(600)));

        Map<String, String> body = Map.of("code", "some-code", "state", state);

        ResponseEntity<Map<String, Object>> response = controller.exchangeToken(body, request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("invalid_state", response.getBody().get("error"));
    }

    @Test
    void login_storesUniqueStatePerCall() throws Exception {
        controller.login();
        controller.login();

        assertEquals(2, controller.getPendingFlows().size());
    }

    @Test
    void buildClientAssertion_includesX5cHeader() throws Exception {
        String assertion = controller.buildClientAssertion("https://localhost:5001/connect/token");
        SignedJWT jwt = SignedJWT.parse(assertion);

        assertNull(jwt.getHeader().getKeyID());
        assertNotNull(jwt.getHeader().getX509CertChain());
        assertFalse(jwt.getHeader().getX509CertChain().isEmpty());
        assertEquals("test-client-id", jwt.getJWTClaimsSet().getIssuer());
        assertEquals("test-client-id", jwt.getJWTClaimsSet().getSubject());
    }

    @Test
    void buildTokenParams_includesUdapVersion() throws Exception {
        Map<String, String> tokenParams = controller.buildTokenParams(
            new SpaAuthController.PendingFlow("verifier", "http://localhost:3000/callback", Instant.now()),
            "auth-code");

        assertEquals("authorization_code", tokenParams.get("grant_type"));
        assertEquals("1", tokenParams.get("udap"));
        assertEquals("test-client-id", tokenParams.get("client_id"));
        assertNotNull(tokenParams.get("client_assertion"));
    }

    @Test
    void getSession_noSession_returnsNotAuthenticated() {
        var request = new MockHttpServletRequest();

        ResponseEntity<Map<String, Object>> response = controller.getSession(request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(false, response.getBody().get("authenticated"));
    }

    @Test
    void getSession_sessionWithoutToken_returnsNotAuthenticated() {
        var request = new MockHttpServletRequest();
        request.getSession(true);

        ResponseEntity<Map<String, Object>> response = controller.getSession(request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(false, response.getBody().get("authenticated"));
    }

    @Test
    void getSession_sessionWithToken_returnsAuthenticatedWithToken() {
        var request = new MockHttpServletRequest();
        var session = request.getSession(true);
        session.setAttribute(SpaAuthController.SESSION_ACCESS_TOKEN, "test-token");

        ResponseEntity<Map<String, Object>> response = controller.getSession(request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("authenticated"));
        assertEquals("test-token", response.getBody().get("access_token"));
    }

    private static CertificateHolder testCertificateHolder() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(false);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        return new CertificateHolder(props);
    }

    private static class StubUdapClientRegistration extends UdapClientRegistration {
        private String clientId = "test-client-id";
        private String authorizeEndpoint = "https://localhost:5001/connect/authorize";
        private String tokenEndpoint = "https://localhost:5001/connect/token";
        private String redirectUri = "http://localhost:3000/callback";

        StubUdapClientRegistration(SecurityProperties securityProperties, CertificateHolder certificateHolder) {
            super(securityProperties, certificateHolder);
        }

        @Override
        public void ensureRegistered() {
            // Test stub: avoid network discovery and registration.
        }

        @Override
        public String getClientId() {
            return clientId;
        }

        @Override
        public String getAuthorizeEndpoint() {
            return authorizeEndpoint;
        }

        @Override
        public String getTokenEndpoint() {
            return tokenEndpoint;
        }

        @Override
        public String getRedirectUri() {
            return redirectUri;
        }
    }
}
