package org.hl7.davinci.security;

import java.io.IOException;
import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
import org.springframework.mock.web.MockHttpSession;
import static org.junit.jupiter.api.Assertions.*;

class SpaAuthControllerTest {

    private static final String TEST_CERT_PATH = "src/test/resources/test-cert.pfx";
    private static final String TEST_CERT_PASSWORD = "testpass";
    private static final String LOCAL_SERVER = "http://fhir.test/fhir";
    private static final String SECOND_SERVER = "https://other.example.org/fhir";

    StubUdapClientRegistration udapClient;
    StubSmartClientDiscoveryService smartDiscovery;
    StubOutboundTargetValidator outboundTargetValidator;
    CertificateHolder certificateHolder;
    SmartClientKeyService smartClientKeyService;
    SecurityProperties securityProperties;
    ServerProperties serverProperties;
    SpaAuthController controller;

    @BeforeEach
    void setUp() throws Exception {
        securityProperties = new SecurityProperties();
        securityProperties.setServerBaseUrl("http://localhost:8080");
        certificateHolder = testCertificateHolder();
        smartClientKeyService = new SmartClientKeyService();
        smartClientKeyService.init();
        var secondProvider = new ServerProperties.ProviderServer();
        secondProvider.setName("second");
        secondProvider.setUrl(SECOND_SERVER);
        serverProperties = new ServerProperties(LOCAL_SERVER, java.util.List.of(secondProvider));
        udapClient = new StubUdapClientRegistration(
            securityProperties, certificateHolder, new OutboundTargetValidator(securityProperties));
        smartDiscovery = new StubSmartClientDiscoveryService(securityProperties);
        outboundTargetValidator = new StubOutboundTargetValidator(securityProperties);
        controller = new SpaAuthController(
            udapClient, certificateHolder, securityProperties, serverProperties,
            new StubUserDetailsService(),
            outboundTargetValidator, smartDiscovery, smartClientKeyService);
    }

    @Test
    void login_redirectsToAuthorizeEndpoint() throws Exception {
        ResponseEntity<?> response = controller.login(null, null, null, null);

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
    void token_uninitializedCertificate_returns503() throws Exception {
        SecurityProperties uninitializedProps = new SecurityProperties();
        uninitializedProps.setServerBaseUrl("http://localhost:8080");
        uninitializedProps.setEnableAuthentication(true);
        uninitializedProps.setFetchCert(false);
        uninitializedProps.setCertFile(null);
        CertificateHolder uninitializedCertHolder = new CertificateHolder(uninitializedProps);
        assertFalse(uninitializedCertHolder.isInitialized());

        SpaAuthController uninitializedController = new SpaAuthController(
            udapClient, uninitializedCertHolder, securityProperties, serverProperties,
            new StubUserDetailsService(), new OutboundTargetValidator(securityProperties), smartDiscovery,
            smartClientKeyService);

        var request = new MockHttpServletRequest();
        String state = "pending-state";
        uninitializedController.getPendingFlows().put(state,
            new SpaAuthController.PendingFlow("verifier", "http://localhost:3000/callback", Instant.now()));
        Map<String, String> body = Map.of("code", "some-code", "state", state);

        ResponseEntity<Map<String, Object>> response = uninitializedController.exchangeToken(body, request);

        assertEquals(503, response.getStatusCode().value());
        assertEquals("certificate_unavailable", response.getBody().get("error"));
    }

    @Test
    void login_storesUniqueStatePerCall() throws Exception {
        controller.login(null, null, null, null);
        controller.login(null, null, null, null);

        assertEquals(2, controller.getPendingFlows().size());
    }

    @Test
    void login_reregistersOnEveryCall() throws Exception {
        controller.login(null, null, null, null);
        controller.login(null, null, null, null);

        assertEquals(2, udapClient.getRefreshCallCount());
    }

    @Test
    void login_reregistrationFailsWithCachedRegistration_stillRedirects() throws Exception {
        udapClient.setHasCachedRegistration(true);
        udapClient.setFailRegistration(true);

        ResponseEntity<?> response = controller.login(null, null, null, null);

        assertEquals(302, response.getStatusCode().value());
        String location = response.getHeaders().getLocation().toString();
        assertTrue(location.startsWith("https://localhost:5001/connect/authorize"));
        assertTrue(location.contains("client_id=test-client-id"));
    }

    @Test
    void login_snapshotsClientIntoPendingFlow() throws Exception {
        controller.login(null, null, null, null);

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

        ResponseEntity<?> response = controller.login(null, null, null, null);

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
        SpaAuthController.TokenRequestSpec spec = controller.buildTokenRequest(
            new SpaAuthController.PendingFlow("verifier", "http://localhost:3000/callback", Instant.now()),
            "auth-code");

        assertEquals("authorization_code", spec.params().get("grant_type"));
        assertEquals("1", spec.params().get("udap"));
        assertEquals("test-client-id", spec.params().get("client_id"));
        assertNotNull(spec.params().get("client_assertion"));
        assertNull(spec.basicAuthHeader());
    }

    @Test
    void smartPublicExchangeUsesCodeVerifierNoAssertion() throws Exception {
        SpaAuthController.PendingFlow flow = new SpaAuthController.PendingFlow(
            "verifier", "http://localhost:3000/callback", Instant.now(),
            "https://ehr.example.com/fhir", "https://ehr.example.com/token",
            "spa-client", "smart-none", null, null, null);
        SpaAuthController.TokenRequestSpec spec = controller.buildTokenRequest(flow, "abc");
        assertEquals("authorization_code", spec.params().get("grant_type"));
        assertEquals("verifier", spec.params().get("code_verifier"));
        assertEquals("spa-client", spec.params().get("client_id"));
        assertNull(spec.params().get("client_assertion"));
        assertNull(spec.basicAuthHeader());
    }

    @Test
    void smartBasicExchangeOmitsClientIdAndSetsBasicHeader() throws Exception {
        SpaAuthController.PendingFlow flow = new SpaAuthController.PendingFlow(
            "verifier", "http://localhost:3000/callback", Instant.now(),
            "https://ehr.example.com/fhir", "https://ehr.example.com/token",
            "spa-client", "smart-basic", "s3cret", null, null);
        SpaAuthController.TokenRequestSpec spec = controller.buildTokenRequest(flow, "abc");
        assertNull(spec.params().get("client_id"));
        String expected = "Basic " + Base64.getEncoder()
            .encodeToString("spa-client:s3cret".getBytes(StandardCharsets.UTF_8));
        assertEquals(expected, spec.basicAuthHeader());
    }

    @Test
    void resolveSmartAuthMethodHonorsOnlyWhitelistedValues() {
        var server = new ServerProperties.ProviderServer();
        assertEquals("smart-none", controller.resolveSmartAuthMethod(null, null));
        assertEquals("smart-none", controller.resolveSmartAuthMethod(server, null));

        server.setUserAuthMethod("basic");
        assertEquals("smart-basic", controller.resolveSmartAuthMethod(server, null));

        server.setUserAuthMethod("private_key_jwt");
        assertEquals("smart-private-key-jwt", controller.resolveSmartAuthMethod(server, null));

        server.setUserAuthMethod("basic_auth");
        assertEquals("smart-none", controller.resolveSmartAuthMethod(server, null));

        server.setUserClientSecret("s3cret");
        assertEquals("smart-basic", controller.resolveSmartAuthMethod(server, null));

        server.setUserAuthMethod("none");
        assertEquals("smart-none", controller.resolveSmartAuthMethod(server, null));
    }

    @Test
    void resolveSmartAuthMethodInfersBasicFromSecretWhenMethodOmitted() {
        var server = new ServerProperties.ProviderServer();
        server.setUserClientSecret("s3cret");

        assertEquals("smart-basic", controller.resolveSmartAuthMethod(server, null));
    }

    @Test
    void storeServerToken_replacementBundleClearsStaleRefreshMetadata() {
        var session = new MockHttpSession();
        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "old-token", "old-id-token",
            3600L, "old-refresh", "https://old-token-endpoint", "old-client", "udap");

        SpaAuthController.storeServerToken(session, "https://ehr.example.com/fhir",
            "new-token", null, null, null, "https://ehr.example.com/token", "new-client", "smart-none");

        assertNull(session.getAttribute(SpaAuthController.SESSION_REFRESH_TOKEN));
        assertNull(session.getAttribute(SpaAuthController.SESSION_ID_TOKEN));
        assertNull(session.getAttribute(SpaAuthController.SESSION_TOKEN_EXPIRES_AT));
        assertEquals("https://ehr.example.com/token",
            session.getAttribute(SpaAuthController.SESSION_TOKEN_ENDPOINT));
        assertEquals("new-client", session.getAttribute(SpaAuthController.SESSION_CLIENT_ID));
    }

    @Test
    void getTokenForServer_nearExpiryWithoutRefreshToken_returnsNull() {
        var session = new MockHttpSession();
        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "tok", null, 10L, null);

        assertNull(SpaAuthController.getTokenForServer(session, LOCAL_SERVER + "/Patient"));
    }

    @Test
    void getTokenForServer_nearExpiryWithRefreshToken_returnsToken() {
        var session = new MockHttpSession();
        SpaAuthController.storeServerToken(session, LOCAL_SERVER, "tok", null, 10L, "refresh-1");

        assertEquals("tok",
            SpaAuthController.getTokenForServer(session, LOCAL_SERVER + "/Patient"));
    }

    @Test
    void buildSmartContextIncludesAppContext() {
        Map<String, Object> tokens = Map.of(
            "patient", "pat-1",
            "appContext", "{\"coverageAssertionId\":\"ca-1\"}");

        Map<String, Object> smartContext = SpaAuthController.buildSmartContext(tokens);

        assertEquals("pat-1", smartContext.get("patient"));
        assertEquals("{\"coverageAssertionId\":\"ca-1\"}", smartContext.get("appContext"));
    }

    @Test
    void smartAsymmetricExchangeCarriesSignedAssertion() throws Exception {
        SpaAuthController.PendingFlow flow = new SpaAuthController.PendingFlow(
            "verifier", "http://localhost:3000/callback", Instant.now(),
            "https://ehr.example.com/fhir", "https://ehr.example.com/token",
            "spa-client", "smart-private-key-jwt", null, null, null);
        SpaAuthController.TokenRequestSpec spec = controller.buildTokenRequest(flow, "abc");
        assertNull(spec.params().get("client_id"));
        SignedJWT assertion = SignedJWT.parse(spec.params().get("client_assertion"));
        assertEquals("spa-client", assertion.getJWTClaimsSet().getIssuer());
        assertEquals(List.of("https://ehr.example.com/token"),
            assertion.getJWTClaimsSet().getAudience());
    }

    @Test
    void udapExchangeUnchanged() throws Exception {
        SpaAuthController.TokenRequestSpec spec = controller.buildTokenRequest(
            new SpaAuthController.PendingFlow("verifier", "http://localhost:3000/callback", Instant.now()),
            "abc");

        assertEquals("1", spec.params().get("udap"));
        assertEquals("test-client-id", spec.params().get("client_id"));
        assertNotNull(spec.params().get("client_assertion"));
        assertNull(spec.basicAuthHeader());
    }

    @Test
    void parseFhirContextHandlesObjectArrayShape() {
        List<Map<String, Object>> raw = List.of(
            Map.of("reference", "Coverage/cov1", "role", "launch"),
            Map.of("canonical", "http://payer.example.com/Questionnaire/q1", "type", "Questionnaire"));
        assertEquals(List.of("Coverage/cov1", "http://payer.example.com/Questionnaire/q1"),
            SpaAuthController.parseFhirContext(raw));
    }

    @Test
    void parseFhirContextHandlesLegacyStringArray() {
        assertEquals(List.of("Coverage/cov1"),
            SpaAuthController.parseFhirContext(List.of("Coverage/cov1")));
    }

    @Test
    void parseFhirContextIgnoresGarbage() {
        assertTrue(SpaAuthController.parseFhirContext("not-a-list").isEmpty());
        assertTrue(SpaAuthController.parseFhirContext(null).isEmpty());
    }

    @Test
    void exchangeToken_smartFlow_capturesLaunchContext() throws Exception {
        HttpServer tokenServer = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        tokenServer.createContext("/token", exchange -> {
            exchange.getRequestBody().readAllBytes();
            String body = """
                {"access_token":"at","patient":"Patient/123",
                 "fhirContext":[{"reference":"Coverage/cov1"},"Encounter/enc1"]}
                """;
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        tokenServer.start();
        try {
            String tokenEndpoint = "http://localhost:" + tokenServer.getAddress().getPort() + "/token";
            String smartServer = "https://ehr.example.com/fhir";
            String state = "smart-context-state-" + UUID.randomUUID();
            controller.getPendingFlows().put(state, new SpaAuthController.PendingFlow(
                "verifier", "http://localhost:3000/callback", Instant.now(),
                smartServer, tokenEndpoint, "spa-client", "smart-ehr-launch", null, "launch-abc", null));

            var request = new MockHttpServletRequest();
            Map<String, String> body = Map.of("code", "abc", "state", state);

            ResponseEntity<Map<String, Object>> response = controller.exchangeToken(body, request);

            assertEquals(200, response.getStatusCode().value());
            @SuppressWarnings("unchecked")
            Map<String, Object> smartContext = (Map<String, Object>) response.getBody().get("smartContext");
            assertNotNull(smartContext);
            assertEquals("Patient/123", smartContext.get("patient"));
            assertEquals(List.of("Coverage/cov1", "Encounter/enc1"), smartContext.get("fhirContext"));
        } finally {
            tokenServer.stop(0);
        }
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
    void login_withServer_noUdapNoSmartClientConfigured_fallsBackToSmartError() throws Exception {
        // No UDAP support (stub's default branch) and no ProviderServer
        // configured for this URL: falls through to SMART, which succeeds
        // discovery but has no client_id to use.
        ResponseEntity<?> response = controller.login("https://unknown.example.org/fhir", null, null, null);

        assertEquals(302, response.getStatusCode().value());
        assertTrue(response.getHeaders().getLocation().toString()
            .contains("error=smart_client_not_configured"));
    }

    @Test
    void login_withServer_withRegistration_redirectsToCustomIssuer() throws Exception {
        ResponseEntity<?> response = controller.login("https://custom.fhir.org/fhir", null, null, null);

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

        ResponseEntity<?> response = controller.login("https://custom.fhir.org/fhir", null, null, null);

        assertEquals(302, response.getStatusCode().value());
        assertEquals(1, udapClient.getDiscoverCallCount());
        String location = response.getHeaders().getLocation().toString();
        assertTrue(location.startsWith("https://custom-issuer.org/authorize"));
    }

    @Test
    void login_withServerAndIdp_includesIdpAndUdapScope() throws Exception {
        ResponseEntity<?> response = controller.login(
            "https://custom.fhir.org/fhir", "https://my-idp.org", null, null);

        assertEquals(302, response.getStatusCode().value());
        String location = response.getHeaders().getLocation().toString();
        assertTrue(location.startsWith("https://custom-issuer.org/authorize"));
        assertTrue(location.contains("idp=https%3A%2F%2Fmy-idp.org"),
            "Should include URL-encoded idp parameter, got: " + location);
        assertTrue(location.contains("udap"), "Scope should include udap for Tiered OAuth");
        assertEquals(1, controller.getPendingFlows().size());
    }

    @Test
    void smartAuthorizeUrlCarriesPkceAudAndState() throws Exception {
        String smartServer = "https://ehr.example.com/fhir";
        var smartProvider = new ServerProperties.ProviderServer();
        smartProvider.setName("smart-ehr");
        smartProvider.setUrl(smartServer);
        smartProvider.setUserClientId("spa-client");
        ServerProperties smartServerProperties = new ServerProperties(
            LOCAL_SERVER, java.util.List.of(smartProvider));
        SpaAuthController smartController = new SpaAuthController(
            udapClient, certificateHolder, securityProperties, smartServerProperties,
            new StubUserDetailsService(), outboundTargetValidator, smartDiscovery, smartClientKeyService);

        ResponseEntity<?> response = smartController.login(smartServer, null, "smart", null);

        assertEquals(302, response.getStatusCode().value());
        String redirect = response.getHeaders().getLocation().toString();
        assertTrue(redirect.startsWith("https://ehr.example.com/oauth/authorize?"));
        assertTrue(redirect.contains("response_type=code"));
        assertTrue(redirect.contains("client_id=spa-client"));
        assertTrue(redirect.contains(
            "aud=" + URLEncoder.encode(smartServer, StandardCharsets.UTF_8)));
        assertTrue(redirect.contains("code_challenge_method=S256"));
        assertTrue(redirect.contains("code_challenge="));
        assertTrue(redirect.contains("state="));
        assertFalse(redirect.contains("idp="));
    }

    @Test
    void runtimeClientIdOverridesConfig() throws Exception {
        // No ProviderServer configured for this URL in the default setUp().
        ResponseEntity<?> response = controller.login(
            "https://ehr.example.com/fhir", null, "smart", "runtime-client");

        assertEquals(302, response.getStatusCode().value());
        assertTrue(response.getHeaders().getLocation().toString()
            .contains("client_id=runtime-client"));
    }

    @Test
    void smartLoginWithoutClientIdFails() throws Exception {
        ResponseEntity<?> response = controller.login(
            "https://bare.example.com/fhir", null, "smart", null);

        assertEquals(302, response.getStatusCode().value());
        assertTrue(response.getHeaders().getLocation().toString()
            .contains("error=smart_client_not_configured"));
    }

    @Test
    void smartLoginRejectsServerWithoutS256() throws Exception {
        smartDiscovery.setSupportsS256(false);

        ResponseEntity<?> response = controller.login(
            "https://weak.example.com/fhir", null, "smart", "c");

        assertEquals(302, response.getStatusCode().value());
        assertTrue(response.getHeaders().getLocation().toString()
            .contains("error=smart_server_unsupported"));
    }

    @Test
    void smartLoginDiscoveryFailureRedirectsWithError() throws Exception {
        smartDiscovery.setShouldFail(true);

        ResponseEntity<?> response = controller.login(
            "https://down.example.com/fhir", null, "smart", "c");

        assertEquals(302, response.getStatusCode().value());
        assertTrue(response.getHeaders().getLocation().toString()
            .contains("error=smart_discovery_failed"));
    }

    @Test
    void smartLoginRejectsValidatorBlockedTokenEndpoint() throws Exception {
        // The stub's discovered token_endpoint for this server. The SSRF
        // gate must reject it even though the authorization_endpoint is fine.
        outboundTargetValidator.rejectUrl("https://blocked.example.com/oauth/token");

        ResponseEntity<?> response = controller.login(
            "https://blocked.example.com/fhir", null, "smart", "c");

        assertEquals(302, response.getStatusCode().value());
        assertTrue(response.getHeaders().getLocation().toString()
            .contains("error=smart_server_unsupported"));
    }

    @Test
    void ehrLaunchBuildsAuthorizeUrlWithLaunchAndAud() throws Exception {
        ResponseEntity<Map<String, Object>> response = controller.smartEhrLaunch(
            Map.of("iss", "https://inferno.example.com/fhir", "launch", "abc123",
                   "clientId", "session-tag"), new MockHttpServletRequest());

        assertEquals(200, response.getStatusCode().value());
        String url = (String) response.getBody().get("authorizeUrl");
        assertTrue(url.contains("launch=abc123"));
        assertTrue(url.contains("scope=" + URLEncoder.encode(
            "launch openid fhirUser patient/*.rs patient/QuestionnaireResponse.cu",
            StandardCharsets.UTF_8)));
        assertTrue(url.contains(
            "aud=" + URLEncoder.encode("https://inferno.example.com/fhir", StandardCharsets.UTF_8)));
        assertTrue(url.contains("code_challenge_method=S256"));
        assertTrue(url.contains("client_id=session-tag"));
    }

    @Test
    void ehrLaunchRejectsMissingParams() throws Exception {
        var request = new MockHttpServletRequest();

        ResponseEntity<Map<String, Object>> response = controller.smartEhrLaunch(
            Map.of("launch", "abc123"), request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("invalid_request", response.getBody().get("error"));

        response = controller.smartEhrLaunch(
            Map.of("iss", "https://inferno.example.com/fhir"), request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("invalid_request", response.getBody().get("error"));
    }

    @Test
    void ehrLaunchRejectsBlockedTarget() throws Exception {
        outboundTargetValidator.rejectUrl("https://blocked-ehr.example.com/fhir");
        var request = new MockHttpServletRequest();

        ResponseEntity<Map<String, Object>> response = controller.smartEhrLaunch(
            Map.of("iss", "https://blocked-ehr.example.com/fhir", "launch", "abc123"), request);

        assertEquals(400, response.getStatusCode().value());
        assertTrue(((String) response.getBody().get("error_description"))
            .contains("Target rejected by test stub"));
        assertEquals(0, smartDiscovery.getDiscoverCallCount());
    }

    @Test
    void ehrLaunchCapabilityGateFailure_leavesActiveServerUnchanged() throws Exception {
        smartDiscovery.setSupportsS256(false);
        var request = new MockHttpServletRequest();
        var session = request.getSession(true);
        SpaAuthController.setActiveServer(session, LOCAL_SERVER);

        ResponseEntity<Map<String, Object>> response = controller.smartEhrLaunch(
            Map.of("iss", "https://weak.example.com/fhir", "launch", "abc123"), request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("smart_server_unsupported", response.getBody().get("error"));
        assertEquals(LOCAL_SERVER, session.getAttribute(SpaAuthController.SESSION_SERVER_URL));
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
    void storeServerTokenRecordsAuthMethod() {
        MockHttpSession session = new MockHttpSession();
        SpaAuthController.storeServerToken(session, "https://ehr.example.com/fhir",
            "at", null, 3600L, "rt", "https://ehr.example.com/token", "spa-client", "smart-none");
        assertEquals("smart-none", session.getAttribute(SpaAuthController.SESSION_AUTH_METHOD));
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

            SpaAuthController.refreshTokenIfNeeded(
                session, securityProperties, certificateHolder, smartClientKeyService);

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
    void refreshTokenIfNeeded_smartNone_sendsClientIdNoAssertionNoBasicHeader() throws Exception {
        AtomicReference<String> tokenRequestBody = new AtomicReference<>();
        AtomicReference<String> authHeader = new AtomicReference<>();
        HttpServer tokenServer = startRefreshStub(tokenRequestBody, authHeader);
        tokenServer.start();
        try {
            String tokenEndpoint = "http://localhost:" + tokenServer.getAddress().getPort() + "/token";
            MockHttpSession session = new MockHttpSession();
            SpaAuthController.storeServerToken(session, "https://ehr.example.com/fhir", "old-token", null,
                1L, "old-refresh", tokenEndpoint, "spa-client", "smart-none");

            SpaAuthController.refreshTokenIfNeeded(
                session, securityProperties, certificateHolder, smartClientKeyService);

            Map<String, String> form = parseForm(tokenRequestBody.get());
            assertEquals("spa-client", form.get("client_id"));
            assertNull(form.get("client_assertion"));
            assertNull(authHeader.get());
            assertEquals("new-token", session.getAttribute(SpaAuthController.SESSION_ACCESS_TOKEN));
        } finally {
            tokenServer.stop(0);
        }
    }

    @Test
    void refreshTokenIfNeeded_smartBasic_rebuildsBasicHeaderOmitsClientId() throws Exception {
        AtomicReference<String> tokenRequestBody = new AtomicReference<>();
        AtomicReference<String> authHeader = new AtomicReference<>();
        HttpServer tokenServer = startRefreshStub(tokenRequestBody, authHeader);
        tokenServer.start();
        try {
            String tokenEndpoint = "http://localhost:" + tokenServer.getAddress().getPort() + "/token";
            MockHttpSession session = new MockHttpSession();
            SpaAuthController.storeServerToken(session, "https://ehr.example.com/fhir", "old-token", null,
                1L, "old-refresh", tokenEndpoint, "spa-client", "smart-basic");
            session.setAttribute(SpaAuthController.SESSION_CLIENT_SECRET, "s3cret");

            SpaAuthController.refreshTokenIfNeeded(
                session, securityProperties, certificateHolder, smartClientKeyService);

            Map<String, String> form = parseForm(tokenRequestBody.get());
            assertNull(form.get("client_id"));
            String expected = "Basic " + Base64.getEncoder()
                .encodeToString("spa-client:s3cret".getBytes(StandardCharsets.UTF_8));
            assertEquals(expected, authHeader.get());
        } finally {
            tokenServer.stop(0);
        }
    }

    @Test
    void refreshTokenIfNeeded_smartPrivateKeyJwt_signsAssertionWithStoredAlg() throws Exception {
        AtomicReference<String> tokenRequestBody = new AtomicReference<>();
        AtomicReference<String> authHeader = new AtomicReference<>();
        HttpServer tokenServer = startRefreshStub(tokenRequestBody, authHeader);
        tokenServer.start();
        try {
            String tokenEndpoint = "http://localhost:" + tokenServer.getAddress().getPort() + "/token";
            MockHttpSession session = new MockHttpSession();
            SpaAuthController.storeServerToken(session, "https://ehr.example.com/fhir", "old-token", null,
                1L, "old-refresh", tokenEndpoint, "spa-client", "smart-private-key-jwt");
            session.setAttribute(SpaAuthController.SESSION_TOKEN_ALG, "ES384");

            SpaAuthController.refreshTokenIfNeeded(
                session, securityProperties, certificateHolder, smartClientKeyService);

            Map<String, String> form = parseForm(tokenRequestBody.get());
            assertNull(form.get("client_id"));
            SignedJWT assertion = SignedJWT.parse(form.get("client_assertion"));
            assertEquals(JWSAlgorithm.ES384, assertion.getHeader().getAlgorithm());
        } finally {
            tokenServer.stop(0);
        }
    }

    private static HttpServer startRefreshStub(
            AtomicReference<String> tokenRequestBody, AtomicReference<String> authHeader) throws IOException {
        HttpServer tokenServer = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        tokenServer.createContext("/token", exchange -> {
            tokenRequestBody.set(new String(
                exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            authHeader.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = """
                {"access_token":"new-token","refresh_token":"new-refresh","expires_in":3600}
                """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        return tokenServer;
    }

    private static Map<String, String> parseForm(String body) {
        Map<String, String> result = new java.util.LinkedHashMap<>();
        for (String pair : body.split("&")) {
            String[] kv = pair.split("=", 2);
            result.put(
                java.net.URLDecoder.decode(kv[0], StandardCharsets.UTF_8),
                kv.length > 1 ? java.net.URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : null);
        }
        return result;
    }

    @Test
    void exchangeToken_smartFlow_expiredIdToken_dropsClaims() throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("name", "Dr. Smith")
            .claim("fhirUser", "Practitioner/1")
            .expirationTime(Date.from(Instant.now().minusSeconds(60)))
            .build();
        SignedJWT idToken = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).build(), claims);
        idToken.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        Map<String, Object> result = exchangeSmartFlowWithIdToken(idToken);

        assertEquals(true, result.get("authenticated"));
        @SuppressWarnings("unchecked")
        Map<String, String> userinfo = (Map<String, String>) result.get("userinfo");
        assertTrue(userinfo.isEmpty());
    }

    @Test
    void exchangeToken_smartFlow_issuerMismatch_dropsClaims() throws Exception {
        smartDiscovery.setIssuer("https://correct-issuer.example.com");
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("name", "Dr. Smith")
            .issuer("https://wrong-issuer.example.com")
            .expirationTime(Date.from(Instant.now().plusSeconds(300)))
            .build();
        SignedJWT idToken = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).build(), claims);
        idToken.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        Map<String, Object> result = exchangeSmartFlowWithIdToken(idToken);

        assertEquals(true, result.get("authenticated"));
        @SuppressWarnings("unchecked")
        Map<String, String> userinfo = (Map<String, String>) result.get("userinfo");
        assertTrue(userinfo.isEmpty());
    }

    @Test
    void exchangeToken_smartFlow_jwksUriFailsSsrfValidation_dropsClaims() throws Exception {
        smartDiscovery.setJwksUri("http://blocked.example.com/jwks");
        outboundTargetValidator.rejectUrl("http://blocked.example.com/jwks");
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("name", "Dr. Smith")
            .expirationTime(Date.from(Instant.now().plusSeconds(300)))
            .build();
        SignedJWT idToken = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).build(), claims);
        idToken.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        Map<String, Object> result = exchangeSmartFlowWithIdToken(idToken);

        assertEquals(true, result.get("authenticated"));
        @SuppressWarnings("unchecked")
        Map<String, String> userinfo = (Map<String, String>) result.get("userinfo");
        assertTrue(userinfo.isEmpty());
    }

    /**
     * Runs exchangeToken through a stub token endpoint returning the given
     * id_token for a smart-none custom-server flow, returning the response body.
     */
    private Map<String, Object> exchangeSmartFlowWithIdToken(SignedJWT idToken) throws Exception {
        HttpServer tokenServer = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        tokenServer.createContext("/token", exchange -> {
            exchange.getRequestBody().readAllBytes();
            String body = "{\"access_token\":\"at\",\"id_token\":\"" + idToken.serialize() + "\"}";
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        tokenServer.start();
        try {
            String tokenEndpoint = "http://localhost:" + tokenServer.getAddress().getPort() + "/token";
            String smartServer = "https://ehr.example.com/fhir";
            String state = "smart-id-token-state-" + UUID.randomUUID();
            controller.getPendingFlows().put(state, new SpaAuthController.PendingFlow(
                "verifier", "http://localhost:3000/callback", Instant.now(),
                smartServer, tokenEndpoint, "spa-client", "smart-none", null, null, null));

            var request = new MockHttpServletRequest();
            Map<String, String> body = Map.of("code", "abc", "state", state);

            ResponseEntity<Map<String, Object>> response = controller.exchangeToken(body, request);
            assertEquals(200, response.getStatusCode().value());
            return response.getBody();
        } finally {
            tokenServer.stop(0);
        }
    }

    @Test
    void setActivePayer_publicHostPassesSsrfCheck_storesNormalized() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActivePayerRequest(
            "https://br-payer.davinci.hl7.org/fhir/", null);

        ResponseEntity<Void> response = controller.setActivePayer(body, request);

        assertEquals(204, response.getStatusCode().value());
        assertEquals("https://br-payer.davinci.hl7.org/fhir",
            request.getSession(false).getAttribute(SpaAuthController.SESSION_PAYER_FHIR_URL));
    }

    @Test
    void setActivePayer_withClientId_storesItForBackendServices() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActivePayerRequest(
            "https://br-payer.davinci.hl7.org/fhir", " payer-client ");

        ResponseEntity<Void> response = controller.setActivePayer(body, request);

        assertEquals(204, response.getStatusCode().value());
        assertEquals("payer-client",
            request.getSession(false).getAttribute(SpaAuthController.SESSION_PAYER_CLIENT_ID));
    }

    @Test
    void setActivePayer_blankClientId_clearsAnyStoredValue() {
        var request = new MockHttpServletRequest();
        request.getSession(true).setAttribute(SpaAuthController.SESSION_PAYER_CLIENT_ID, "stale");
        var body = new SpaAuthController.ActivePayerRequest(
            "https://br-payer.davinci.hl7.org/fhir", "  ");

        controller.setActivePayer(body, request);

        assertNull(request.getSession(false).getAttribute(SpaAuthController.SESSION_PAYER_CLIENT_ID));
    }

    @Test
    void setActivePayer_missingFhirUrl_returns400() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActivePayerRequest(null, null);

        ResponseEntity<Void> response = controller.setActivePayer(body, request);

        assertEquals(400, response.getStatusCode().value());
    }

    @Test
    void setActivePayer_privateIp_returns400() {
        var request = new MockHttpServletRequest();
        var body = new SpaAuthController.ActivePayerRequest("http://10.0.0.1/fhir", null);

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

    /**
     * Network-free stand-in for SMART discovery. Succeeds for any URL by
     * default, deriving authorize/token endpoints from the URL's origin.
     * Tests toggle {@link #setSupportsS256} or {@link #setShouldFail} for
     * the unsupported-server and discovery-failure cases.
     */
    private static class StubSmartClientDiscoveryService extends SmartClientDiscoveryService {
        private boolean supportsS256 = true;
        private boolean shouldFail = false;
        private String issuer;
        private String jwksUri;
        private int discoverCallCount = 0;

        StubSmartClientDiscoveryService(SecurityProperties securityProperties) {
            super(securityProperties, new OutboundTargetValidator(securityProperties));
        }

        @Override
        public SmartConfiguration discover(String fhirBaseUrl) throws Exception {
            discoverCallCount++;
            if (shouldFail) {
                throw new IllegalStateException("SMART configuration fetch failed for " + fhirBaseUrl);
            }
            URI uri = URI.create(fhirBaseUrl);
            String origin = uri.getScheme() + "://" + uri.getAuthority();
            return new SmartConfiguration(
                origin + "/oauth/authorize",
                origin + "/oauth/token",
                List.of(),
                List.of("authorization_code"),
                supportsS256 ? List.of("S256") : List.of("plain"),
                List.of(),
                List.of(),
                issuer,
                jwksUri);
        }

        void setSupportsS256(boolean supportsS256) {
            this.supportsS256 = supportsS256;
        }

        void setShouldFail(boolean shouldFail) {
            this.shouldFail = shouldFail;
        }

        void setIssuer(String issuer) {
            this.issuer = issuer;
        }

        void setJwksUri(String jwksUri) {
            this.jwksUri = jwksUri;
        }

        int getDiscoverCallCount() {
            return discoverCallCount;
        }
    }

    /**
     * Real SSRF checks still apply to private IPs and unresolvable hosts.
     * Fixture hosts under {@code .example.*} do not resolve in DNS, so they
     * are waved through without a real lookup. {@link #rejectUrl} blocks a
     * single target, for SSRF-gate tests on the SMART discovery endpoints.
     */
    private static class StubOutboundTargetValidator extends OutboundTargetValidator {
        private String rejectedUrl;

        StubOutboundTargetValidator(SecurityProperties securityProperties) {
            super(securityProperties);
        }

        @Override
        public URI validate(String rawUrl) {
            if (rawUrl != null && rawUrl.equals(rejectedUrl)) {
                throw new IllegalArgumentException("Target rejected by test stub: " + rawUrl);
            }
            if (rawUrl != null && rawUrl.contains(".example.")) {
                return URI.create(rawUrl);
            }
            return super.validate(rawUrl);
        }

        void rejectUrl(String url) {
            this.rejectedUrl = url;
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
