package org.hl7.davinci.security;

import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import com.sun.net.httpserver.HttpServer;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.util.UrlMatchUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.junit.jupiter.api.Assertions.*;

class SpaAuthControllerTest {

    private static final String TEST_CERT_PATH = "src/test/resources/test-cert.pfx";
    private static final String TEST_CERT_PASSWORD = "testpass";
    private static final String LOCAL_SERVER = "http://fhir.test/fhir";
    private static final String SECOND_SERVER = "https://other.example.org/fhir";

    StubUdapClientRegistration udapClient;
    CertificateHolder certificateHolder;
    SecurityProperties securityProperties;
    ServerProperties serverProperties;
    SpaAuthController controller;

    @BeforeEach
    void setUp() throws Exception {
        securityProperties = new SecurityProperties();
        securityProperties.setServerBaseUrl("http://localhost:8080");
        certificateHolder = testCertificateHolder();
        var secondProvider = new ServerProperties.ProviderServer();
        secondProvider.setName("second");
        secondProvider.setUrl(SECOND_SERVER);
        serverProperties = new ServerProperties(LOCAL_SERVER, java.util.List.of(secondProvider));
        udapClient = new StubUdapClientRegistration(
            securityProperties, certificateHolder, new OutboundTargetValidator(securityProperties));
        controller = new SpaAuthController(
            udapClient, certificateHolder, securityProperties, serverProperties,
            new StubUserDetailsService(),
            new OutboundTargetValidator(securityProperties));
    }

    @Test
    void login_redirectsToAuthorizeEndpoint() throws Exception {
        ResponseEntity<?> response = controller.login(null, null);

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
        controller.login(null, null);
        controller.login(null, null);

        assertEquals(2, controller.getPendingFlows().size());
    }

    @Test
    void login_reregistersOnEveryCall() throws Exception {
        controller.login(null, null);
        controller.login(null, null);

        assertEquals(2, udapClient.getRefreshCallCount());
    }

    @Test
    void login_reregistrationFailsWithCachedRegistration_stillRedirects() throws Exception {
        udapClient.setHasCachedRegistration(true);
        udapClient.setFailRegistration(true);

        ResponseEntity<?> response = controller.login(null, null);

        assertEquals(302, response.getStatusCode().value());
        String location = response.getHeaders().getLocation().toString();
        assertTrue(location.startsWith("https://localhost:5001/connect/authorize"));
        assertTrue(location.contains("client_id=test-client-id"));
    }

    @Test
    void login_snapshotsClientIntoPendingFlow() throws Exception {
        controller.login(null, null);

        SpaAuthController.PendingFlow flow =
            controller.getPendingFlows().values().iterator().next();
        assertEquals("test-client-id", flow.clientId());
        assertEquals("https://localhost:5001/connect/token", flow.tokenEndpoint());
        assertNull(flow.serverUrl());
    }

    @Test
    void login_withoutExternalBaseUrl_redirectsToRelativeLoginOnConnectFailure() throws Exception {
        securityProperties.setExternalBaseUrl(null);
        udapClient.setFailRegistration(true);

        ResponseEntity<?> response = controller.login(null, null);

        assertEquals(302, response.getStatusCode().value());
        assertEquals("/login?error=auth_server_unavailable",
            response.getHeaders().getLocation().toString());
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
        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "test-token", null);

        ResponseEntity<Map<String, Object>> response = controller.getSession(request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("authenticated"));
        assertEquals("test-token", response.getBody().get("access_token"));
        assertEquals(LOCAL_SERVER, response.getBody().get("serverUrl"));
    }

    @Test
    void getSession_customServerToken_returnsAuthenticated() {
        var request = new MockHttpServletRequest();
        var session = request.getSession(true);
        String customServer = "https://custom.fhir.org/fhir";
        SpaAuthController.storeServerToken(session, customServer, "custom-token", null);

        ResponseEntity<Map<String, Object>> response = controller.getSession(request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("authenticated"));
        assertEquals("custom-token", response.getBody().get("access_token"));
        assertEquals(customServer, response.getBody().get("serverUrl"));
    }

    @Test
    void login_withServer_noRegistration_returns400() throws Exception {
        ResponseEntity<?> response = controller.login("https://unknown.fhir.org/fhir", null);

        assertEquals(400, response.getStatusCode().value());
        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        assertEquals("registration_required", body.get("error"));
    }

    @Test
    void login_withServer_withRegistration_redirectsToCustomIssuer() throws Exception {
        ResponseEntity<?> response = controller.login("https://custom.fhir.org/fhir", null);

        assertEquals(302, response.getStatusCode().value());
        String location = response.getHeaders().getLocation().toString();
        assertTrue(location.startsWith("https://custom-issuer.org/authorize"));
        assertTrue(location.contains("client_id=custom-client-id"));
        assertFalse(location.contains("idp="), "Custom server flow should not include idp parameter");
        assertEquals(1, controller.getPendingFlows().size());
    }

    @Test
    void login_withServer_rediscoveryRestoresMissingRegistration() throws Exception {
        udapClient.setCustomRegistrationCached(false);

        ResponseEntity<?> response = controller.login("https://custom.fhir.org/fhir", null);

        assertEquals(302, response.getStatusCode().value());
        assertEquals(1, udapClient.getDiscoverCallCount());
        String location = response.getHeaders().getLocation().toString();
        assertTrue(location.startsWith("https://custom-issuer.org/authorize"));
    }

    @Test
    void login_withServerAndIdp_includesIdpAndUdapScope() throws Exception {
        ResponseEntity<?> response = controller.login(
            "https://custom.fhir.org/fhir", "https://my-idp.org");

        assertEquals(302, response.getStatusCode().value());
        String location = response.getHeaders().getLocation().toString();
        assertTrue(location.startsWith("https://custom-issuer.org/authorize"));
        assertTrue(location.contains("idp=https%3A%2F%2Fmy-idp.org"),
            "Should include URL-encoded idp parameter, got: " + location);
        assertTrue(location.contains("udap"), "Scope should include udap for Tiered OAuth");
        assertEquals(1, controller.getPendingFlows().size());
    }

    @Test
    void getSession_withStoredUserinfo_returnsUserinfo() {
        var request = new MockHttpServletRequest();
        var session = request.getSession(true);
        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "test-token", null);
        session.setAttribute(SpaAuthController.SESSION_USERINFO, Map.of("name", "Dr. Test"));

        ResponseEntity<Map<String, Object>> response = controller.getSession(request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("authenticated"));
        @SuppressWarnings("unchecked")
        Map<String, String> userinfo = (Map<String, String>) response.getBody().get("userinfo");
        assertNotNull(userinfo);
        assertEquals("Dr. Test", userinfo.get("name"));
    }

    @Test
    void getSession_emptyStoredUserinfo_noUserinfoInResponse() {
        var request = new MockHttpServletRequest();
        var session = request.getSession(true);
        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "test-token", null);
        session.setAttribute(SpaAuthController.SESSION_USERINFO, Map.of());

        ResponseEntity<Map<String, Object>> response = controller.getSession(request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(true, response.getBody().get("authenticated"));
        assertNull(response.getBody().get("userinfo"));
    }

    @Test
    void setActiveServer_validUrl_returnsNoContentAndStoresNormalized() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActiveServerRequest(LOCAL_SERVER + "/");

        ResponseEntity<Void> response = controller.setActiveServer(body, request);

        assertEquals(204, response.getStatusCode().value());
        assertEquals(LOCAL_SERVER,
            request.getSession(false).getAttribute(SpaAuthController.SESSION_SERVER_URL));
    }

    @Test
    void setActiveServer_missingUrl_returns400() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActiveServerRequest(null);

        ResponseEntity<Void> response = controller.setActiveServer(body, request);

        assertEquals(400, response.getStatusCode().value());
    }

    @Test
    void setActiveServer_blankUrl_returns400() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActiveServerRequest("   ");

        ResponseEntity<Void> response = controller.setActiveServer(body, request);

        assertEquals(400, response.getStatusCode().value());
    }

    @Test
    void setActiveServer_urlChange_keepsTokenBundleScopedToOriginalServer() {
        // Tokens are scoped to SESSION_TOKEN_SERVER_URL, so changing the
        // active server does NOT invalidate them. This is what lets the
        // user log in to one server and then anonymously browse another
        // without losing their authenticated identity.
        var request = new MockHttpServletRequest();
        var session = request.getSession(true);
        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "old-token", "old-id-token",
            3600L, "old-refresh", "https://old-token-endpoint", "old-client");
        session.setAttribute(SpaAuthController.SESSION_USERINFO, Map.of("name", "Old User"));

        var body = new SpaAuthController.ActiveServerRequest(SECOND_SERVER);
        ResponseEntity<Void> response = controller.setActiveServer(body, request);

        assertEquals(204, response.getStatusCode().value());
        assertEquals(SECOND_SERVER,
            session.getAttribute(SpaAuthController.SESSION_SERVER_URL));
        // Token bundle preserved, but bound to LOCAL_SERVER.
        assertEquals("old-token",
            session.getAttribute(SpaAuthController.SESSION_ACCESS_TOKEN));
        assertEquals(LOCAL_SERVER,
            session.getAttribute(SpaAuthController.SESSION_TOKEN_SERVER_URL));
        // getTokenForServer returns null for the new active server (URL
        // mismatch with the auth URL) but still works for the auth URL.
        assertNull(SpaAuthController.getTokenForServer(session, SECOND_SERVER + "/Patient"));
        assertEquals("old-token",
            SpaAuthController.getTokenForServer(session, LOCAL_SERVER + "/Patient"));
    }

    @Test
    void setActiveServer_sameUrl_keepsTokenBundle() {
        var request = new MockHttpServletRequest();
        var session = request.getSession(true);
        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "kept-token", null);

        var body = new SpaAuthController.ActiveServerRequest(LOCAL_SERVER);
        ResponseEntity<Void> response = controller.setActiveServer(body, request);

        assertEquals(204, response.getStatusCode().value());
        assertEquals("kept-token",
            session.getAttribute(SpaAuthController.SESSION_ACCESS_TOKEN));
    }

    @Test
    void refreshTokenIfNeeded_keepsTokenScopedToOriginalServerWhenActiveServerChanged() throws Exception {
        AtomicReference<String> tokenRequestBody = new AtomicReference<>();
        HttpServer tokenServer = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        tokenServer.createContext("/token", exchange -> {
            tokenRequestBody.set(new String(
                exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] body = """
                {"access_token":"new-token","refresh_token":"new-refresh","expires_in":3600}
                """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        tokenServer.start();
        try {
            String tokenEndpoint = "http://localhost:" + tokenServer.getAddress().getPort() + "/token";
            var request = new MockHttpServletRequest();
            var session = request.getSession(true);
            SpaAuthController.storeServerToken(session, LOCAL_SERVER, "old-token", null,
                1L, "old-refresh", tokenEndpoint, "refresh-client");
            SpaAuthController.setActiveServer(session, SECOND_SERVER);

            SpaAuthController.refreshTokenIfNeeded(session, securityProperties, certificateHolder);

            assertTrue(tokenRequestBody.get().contains("refresh_token=old-refresh"));
            assertEquals("new-token",
                session.getAttribute(SpaAuthController.SESSION_ACCESS_TOKEN));
            assertEquals("new-refresh",
                session.getAttribute(SpaAuthController.SESSION_REFRESH_TOKEN));
            assertEquals(SECOND_SERVER,
                session.getAttribute(SpaAuthController.SESSION_SERVER_URL));
            assertEquals(LOCAL_SERVER,
                session.getAttribute(SpaAuthController.SESSION_TOKEN_SERVER_URL));
            assertNull(SpaAuthController.getTokenForServer(session, SECOND_SERVER + "/Patient"));
            assertEquals("new-token",
                SpaAuthController.getTokenForServer(session, LOCAL_SERVER + "/Patient"));
        } finally {
            tokenServer.stop(0);
        }
    }

    @Test
    void setActivePayer_publicHostPassesSsrfCheck_storesNormalized() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActivePayerRequest(
            "https://br-payer.davinci.hl7.org/fhir/");

        ResponseEntity<Void> response = controller.setActivePayer(body, request);

        assertEquals(204, response.getStatusCode().value());
        assertEquals("https://br-payer.davinci.hl7.org/fhir",
            request.getSession(false).getAttribute(SpaAuthController.SESSION_PAYER_FHIR_URL));
    }

    @Test
    void setActivePayer_missingFhirUrl_returns400() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActivePayerRequest(null);

        ResponseEntity<Void> response = controller.setActivePayer(body, request);

        assertEquals(400, response.getStatusCode().value());
    }

    @Test
    void setActivePayer_privateIp_returns400() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActivePayerRequest("http://10.0.0.1/fhir");

        ResponseEntity<Void> response = controller.setActivePayer(body, request);

        assertEquals(400, response.getStatusCode().value());
    }

    @Test
    void setActiveServer_privateIpFailingSsrfCheck_returns400() {
        // 10.0.0.1 is a private (site-local) IPv4 address — not in
        // allowedLocalHosts, not a configured known provider. SSRF guard
        // rejects it.
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActiveServerRequest("http://10.0.0.1/fhir");

        ResponseEntity<Void> response = controller.setActiveServer(body, request);

        assertEquals(400, response.getStatusCode().value());
    }

    @Test
    void buildUserinfoFromClaims_resolvesNameFromClaims() {
        // Prefers "name" claim
        Map<String, String> result = SpaAuthController.buildUserinfoFromClaims(
            Map.of("name", "Jane Doe", "email", "jane@test.com"));
        assertEquals("Jane Doe", result.get("name"));

        // Falls back to preferred_username
        result = SpaAuthController.buildUserinfoFromClaims(
            Map.of("preferred_username", "jdoe"));
        assertEquals("jdoe", result.get("name"));

        // Falls back to given + family
        result = SpaAuthController.buildUserinfoFromClaims(
            Map.of("given_name", "Jane", "family_name", "Doe"));
        assertEquals("Jane Doe", result.get("name"));

        // Falls back to email
        result = SpaAuthController.buildUserinfoFromClaims(
            Map.of("email", "jane@test.com"));
        assertEquals("jane@test.com", result.get("name"));

        // Includes fhirUser and extracts type
        result = SpaAuthController.buildUserinfoFromClaims(
            Map.of("name", "Jane", "fhirUser", "Practitioner/123"));
        assertEquals("Jane", result.get("name"));
        assertEquals("Practitioner/123", result.get("fhirUser"));
        assertEquals("Practitioner", result.get("fhirUserType"));

        result = SpaAuthController.buildUserinfoFromClaims(
            Map.of("fhirUser", "https://ehr.example/fhir/Practitioner/123"));
        assertEquals("https://ehr.example/fhir/Practitioner/123", result.get("fhirUser"));
        assertEquals("Practitioner", result.get("fhirUserType"));
    }

    @Test
    void extractClaimsFromIdToken_extractsFhirUser() throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("name", "Dr. Smith")
            .claim("fhirUser", "Practitioner/456")
            .claim("sub", "user-123")
            .build();

        SignedJWT jwt = new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256).build(), claims);
        jwt.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        Map<String, String> result = SpaAuthController.extractClaimsFromIdToken(jwt.serialize());

        assertEquals("Dr. Smith", result.get("name"));
        assertEquals("Practitioner/456", result.get("fhirUser"));
        assertEquals("Practitioner", result.get("fhirUserType"));
    }

    @Test
    void extractClaimsFromIdToken_withoutFhirUser_returnsNameOnly() throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("name", "Jane Doe")
            .claim("email", "jane@example.com")
            .build();

        SignedJWT jwt = new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256).build(), claims);
        jwt.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        Map<String, String> result = SpaAuthController.extractClaimsFromIdToken(jwt.serialize());

        assertEquals("Jane Doe", result.get("name"));
        assertNull(result.get("fhirUser"));
        assertNull(result.get("fhirUserType"));
    }

    @Test
    void extractClaimsFromIdToken_patientFhirUser_extractsType() throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("fhirUser", "Patient/789")
            .build();

        SignedJWT jwt = new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256).build(), claims);
        jwt.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        Map<String, String> result = SpaAuthController.extractClaimsFromIdToken(jwt.serialize());

        assertEquals("Patient/789", result.get("fhirUser"));
        assertEquals("Patient", result.get("fhirUserType"));
    }

    @Test
    void extractClaimsFromIdToken_invalidJwt_returnsEmpty() {
        Map<String, String> result = SpaAuthController.extractClaimsFromIdToken("not-a-jwt");

        assertTrue(result.isEmpty());
    }

    @Test
    void extractClaimsFromIdToken_nullSafe_returnsEmpty() {
        // Verify the method handles edge cases gracefully
        Map<String, String> result = SpaAuthController.extractClaimsFromIdToken("");

        assertTrue(result.isEmpty());
    }

    private static CertificateHolder testCertificateHolder() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(false);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        return new CertificateHolder(props);
    }

    private static class StubUserDetailsService extends FhirUserDetailsService {
        StubUserDetailsService() {
            super(null, null);
        }

        @Override
        public FhirUserDetails getFhirUser(String username) {
            return null;
        }
    }

    private static class StubUdapClientRegistration extends UdapClientRegistration {
        private String clientId = "test-client-id";
        private String authorizeEndpoint = "https://localhost:5001/connect/authorize";
        private String tokenEndpoint = "https://localhost:5001/connect/token";
        private String redirectUri = "http://localhost:3000/callback";
        private boolean customRegistrationCached = true;
        private boolean failRegistration = false;
        private boolean hasCachedRegistration = false;
        private int refreshCallCount = 0;
        private int discoverCallCount = 0;

        StubUdapClientRegistration(SecurityProperties securityProperties,
                CertificateHolder certificateHolder,
                OutboundTargetValidator outboundTargetValidator) {
            super(securityProperties, certificateHolder, outboundTargetValidator);
        }

        /**
         * Network-free stand-in mirroring the real contract: throws only
         * when nothing is cached; a cached registration swallows refresh
         * failures.
         */
        @Override
        public void ensureFreshRegistration() throws Exception {
            refreshCallCount++;
            if (hasCachedRegistration) {
                return;
            }
            if (failRegistration) {
                throw new ConnectException("UDAP auth server unavailable");
            }
            hasCachedRegistration = true;
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

        @Override
        public DiscoveryResult discoverAndRegister(String fhirServerUrl, boolean forceRegistration) {
            discoverCallCount++;
            if ("https://custom.fhir.org/fhir".equals(
                    org.hl7.davinci.util.UrlMatchUtil.normalizeUrl(fhirServerUrl))) {
                customRegistrationCached = true;
                return new DiscoveryResult(
                    true, "https://custom-issuer.org", "https://custom-issuer.org/authorize",
                    true, false);
            }
            return new DiscoveryResult(false, null, null, false, false);
        }

        @Override
        public ServerRegistration getRegistrationForServer(String fhirServerUrl) {
            if ("https://custom.fhir.org/fhir".equals(
                    org.hl7.davinci.util.UrlMatchUtil.normalizeUrl(fhirServerUrl))
                    && customRegistrationCached) {
                return new ServerRegistration(
                    "custom-client-id", "https://custom-issuer.org/authorize",
                    "https://custom-issuer.org/token", "http://localhost:3000/callback",
                    "https://custom-issuer.org", "https://custom-issuer.org/userinfo");
            }
            return null;
        }

        void setCustomRegistrationCached(boolean customRegistrationCached) {
            this.customRegistrationCached = customRegistrationCached;
        }

        void setFailRegistration(boolean failRegistration) {
            this.failRegistration = failRegistration;
        }

        void setHasCachedRegistration(boolean hasCachedRegistration) {
            this.hasCachedRegistration = hasCachedRegistration;
        }

        int getRefreshCallCount() {
            return refreshCallCount;
        }

        int getDiscoverCallCount() {
            return discoverCallCount;
        }
    }
}
