package org.hl7.davinci.security;

import java.net.ConnectException;
import java.time.Instant;
import java.util.Map;
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
        serverProperties = new ServerProperties(LOCAL_SERVER, null);
        udapClient = new StubUdapClientRegistration(
            securityProperties, certificateHolder, new OutboundTargetValidator(securityProperties));
        controller = new SpaAuthController(udapClient, certificateHolder, securityProperties, serverProperties);
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
    void login_withoutExternalBaseUrl_redirectsToRelativeLoginOnConnectFailure() throws Exception {
        securityProperties.setExternalBaseUrl(null);
        udapClient.setFailEnsureRegistered(true);

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

    private static class StubUdapClientRegistration extends UdapClientRegistration {
        private String clientId = "test-client-id";
        private String authorizeEndpoint = "https://localhost:5001/connect/authorize";
        private String tokenEndpoint = "https://localhost:5001/connect/token";
        private String redirectUri = "http://localhost:3000/callback";
        private boolean customRegistrationCached = true;
        private boolean failEnsureRegistered = false;
        private int discoverCallCount = 0;

        StubUdapClientRegistration(SecurityProperties securityProperties,
                CertificateHolder certificateHolder,
                OutboundTargetValidator outboundTargetValidator) {
            super(securityProperties, certificateHolder, outboundTargetValidator);
        }

        @Override
        public void ensureRegistered() throws Exception {
            if (failEnsureRegistered) {
                throw new ConnectException("UDAP auth server unavailable");
            }
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
        public DiscoveryResult discoverAndRegister(String fhirServerUrl) {
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

        void setFailEnsureRegistered(boolean failEnsureRegistered) {
            this.failEnsureRegistered = failEnsureRegistered;
        }

        int getDiscoverCallCount() {
            return discoverCallCount;
        }
    }
}
