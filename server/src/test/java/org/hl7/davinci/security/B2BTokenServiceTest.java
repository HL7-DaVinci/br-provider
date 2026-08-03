package org.hl7.davinci.security;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.net.http.HttpRequest;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Flow;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.hl7.davinci.config.ServerProperties;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class B2BTokenServiceTest {

    private static final String TEST_CERT_PATH = "src/test/resources/test-cert.pfx";
    private static final String TEST_CERT_PASSWORD = "testpass";

    @Test
    void clientAssertion_usesRegisteredClientIdForIssuerAndSubject() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(false);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        props.setServerBaseUrl("http://localhost:8080");

        CertificateHolder certificateHolder = new CertificateHolder(props);
        B2BTokenService service = new B2BTokenService(
            certificateHolder,
            props,
            new OutboundTargetValidator(props),
            new ServerProperties(),
            new SmartClientKeyService(),
            new SmartClientDiscoveryService(props, new OutboundTargetValidator(props))
        );

        Method buildClientAssertionJwt = B2BTokenService.class.getDeclaredMethod(
            "buildClientAssertionJwt",
            String.class,
            String.class
        );
        buildClientAssertionJwt.setAccessible(true);

        String clientId = "registered-client";
        String tokenEndpoint = "https://payer.example/token";
        String assertion = (String) buildClientAssertionJwt.invoke(
            service,
            clientId,
            tokenEndpoint
        );

        SignedJWT parsed = SignedJWT.parse(assertion);
        assertEquals(clientId, parsed.getJWTClaimsSet().getIssuer());
        assertEquals(clientId, parsed.getJWTClaimsSet().getSubject());
        assertEquals(List.of(tokenEndpoint), parsed.getJWTClaimsSet().getAudience());
    }

    @Test
    void tokenRejectedWithStaleClient_reregistersAndRetries() throws Exception {
        AtomicInteger registerCount = new AtomicInteger();
        AtomicInteger tokenCount = new AtomicInteger();

        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        String baseUrl = "http://localhost:" + server.getAddress().getPort();

        server.createContext("/fhir/.well-known/udap", exchange -> respond(exchange, 200,
            "{\"issuer\":\"" + baseUrl + "\","
            + "\"token_endpoint\":\"" + baseUrl + "/token\","
            + "\"registration_endpoint\":\"" + baseUrl + "/register\"}"));
        server.createContext("/register", exchange -> respond(exchange, 201,
            "{\"client_id\":\"client-" + registerCount.incrementAndGet() + "\"}"));
        server.createContext("/token", exchange -> {
            // First token request simulates an authorization server that lost
            // its client database; subsequent requests succeed.
            if (tokenCount.incrementAndGet() == 1) {
                respond(exchange, 401, "{\"error\":\"invalid_client\"}");
            } else {
                respond(exchange, 200, "{\"access_token\":\"tok-2\",\"expires_in\":300}");
            }
        });
        server.start();

        try {
            SecurityProperties props = new SecurityProperties();
            props.setEnableAuthentication(true);
            props.setFetchCert(false);
            props.setCertFile(TEST_CERT_PATH);
            props.setCertPassword(TEST_CERT_PASSWORD);
            props.setServerBaseUrl("http://localhost:8080");

            B2BTokenService service = new B2BTokenService(
                new CertificateHolder(props), props, new OutboundTargetValidator(props),
                new ServerProperties(), new SmartClientKeyService(),
                new SmartClientDiscoveryService(props, new OutboundTargetValidator(props)));

            // Seed the registration cache with client-1
            String token = service.getTokenForServer(baseUrl + "/fhir", List.of("system/*.read"));

            assertNotNull(token);
            assertEquals("tok-2", token);
            assertEquals(2, registerCount.get(), "should re-register after the token rejection");
            assertEquals(2, tokenCount.get(), "should retry the token request once");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void backendServicesRequestUsesAssertionAndClientCredentials() throws Exception {
        SmartClientKeyService keyService = new SmartClientKeyService();
        keyService.init();

        B2BTokenService service = newBackendServicesTestService(keyService, mock(SmartClientDiscoveryService.class));

        HttpRequest request = service.buildBackendServicesRequest(
            "provider-ri", "https://payer.example.com/oauth/token", "system/*.rs", JWSAlgorithm.RS384);

        String body = bodyOf(request);
        assertTrue(body.contains("grant_type=client_credentials"));
        assertTrue(body.contains("client_assertion_type="));
        assertFalse(body.contains("client_id="));

        String assertion = extractFormParam(body, "client_assertion");
        SignedJWT parsed = SignedJWT.parse(assertion);
        assertEquals("provider-ri", parsed.getJWTClaimsSet().getIssuer());
        assertEquals(List.of("https://payer.example.com/oauth/token"), parsed.getJWTClaimsSet().getAudience());
    }

    @Test
    void backendServicesPayerWithoutClientIdYieldsNull() throws Exception {
        String targetUrl = "https://payer.example.com/fhir";
        ServerProperties serverProperties = payerAuthConfig(targetUrl, "smart-backend", null, null);
        SmartClientDiscoveryService discovery = mock(SmartClientDiscoveryService.class);

        B2BTokenService service = newBackendServicesTestService(
            serverProperties, new SmartClientKeyService(), discovery);

        String token = service.getTokenForServer(targetUrl, List.of("system/*.rs"));

        assertNull(token);
        verifyNoInteractions(discovery);
    }

    @Test
    void smartBackendHintWithoutConfiguredClientYieldsNull() throws Exception {
        String targetUrl = "https://payer.example.com/fhir";
        CertificateHolder certificateHolder = mock(CertificateHolder.class);
        SmartClientDiscoveryService discovery = mock(SmartClientDiscoveryService.class);

        SecurityProperties props = new SecurityProperties();
        B2BTokenService service = new B2BTokenService(
            certificateHolder, props, new OutboundTargetValidator(props),
            new ServerProperties(), new SmartClientKeyService(), discovery);

        String token = service.getTokenForServer(targetUrl, List.of("system/*.rs"), "smart-backend");

        assertNull(token);
        verifyNoInteractions(certificateHolder);
        verifyNoInteractions(discovery);
    }

    @Test
    void smartBackendHintUsesTheSessionClientIdForAnUnconfiguredPayer() throws Exception {
        String targetUrl = "https://payer.example.com/fhir";
        CertificateHolder certificateHolder = mock(CertificateHolder.class);
        SmartClientDiscoveryService discovery = mock(SmartClientDiscoveryService.class);

        SecurityProperties props = new SecurityProperties();
        B2BTokenService service = new B2BTokenService(
            certificateHolder, props, new OutboundTargetValidator(props),
            new ServerProperties(), new SmartClientKeyService(), discovery);

        String token = service.getTokenForServer(
            targetUrl, List.of("system/*.rs"), "smart-backend", "session-client");

        // Discovery runs only once a client id is in hand, so reaching it
        // proves the session value was accepted in place of configuration.
        assertNull(token);
        verify(discovery).discover(targetUrl);
        verifyNoInteractions(certificateHolder);
    }

    @Test
    void b2bHintOverridesSmartBackendConfig() throws Exception {
        String targetUrl = "https://payer.example.com/fhir";
        ServerProperties serverProperties = payerAuthConfig(targetUrl, "smart-backend", null, "provider-ri");
        CertificateHolder certificateHolder = mock(CertificateHolder.class);
        when(certificateHolder.ensureInitialized()).thenReturn(false);
        SmartClientDiscoveryService discovery = mock(SmartClientDiscoveryService.class);

        SecurityProperties props = new SecurityProperties();
        B2BTokenService service = new B2BTokenService(
            certificateHolder, props, new OutboundTargetValidator(props),
            serverProperties, new SmartClientKeyService(), discovery);

        String token = service.getTokenForServer(targetUrl, List.of("system/*.rs"), "b2b");

        assertNull(token);
        verify(certificateHolder).ensureInitialized();
        verifyNoInteractions(discovery);
    }

    @Test
    void authTypeNoneShortCircuits() throws Exception {
        String targetUrl = "https://payer.example.com/fhir";
        ServerProperties serverProperties = payerAuthConfig(targetUrl, "none", null, null);
        CertificateHolder certificateHolder = mock(CertificateHolder.class);
        SmartClientDiscoveryService discovery = mock(SmartClientDiscoveryService.class);

        SecurityProperties props = new SecurityProperties();
        B2BTokenService service = new B2BTokenService(
            certificateHolder, props, new OutboundTargetValidator(props),
            serverProperties, new SmartClientKeyService(), discovery);

        String token = service.getTokenForServer(targetUrl, List.of("system/*.rs"));

        assertNull(token);
        verifyNoInteractions(certificateHolder);
        verifyNoInteractions(discovery);
    }

    @Test
    void es384ChosenWhenServerOnlyAdvertisesEs384() throws Exception {
        AtomicReference<String> capturedBody = new AtomicReference<>();

        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        String baseUrl = "http://localhost:" + server.getAddress().getPort();

        server.createContext("/.well-known/smart-configuration", exchange -> respond(exchange, 200,
            "{\"token_endpoint\":\"" + baseUrl + "/token\","
            + "\"token_endpoint_auth_signing_alg_values_supported\":[\"ES384\"]}"));
        server.createContext("/token", exchange -> {
            capturedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, 200, "{\"access_token\":\"backend-tok\",\"expires_in\":300}");
        });
        server.start();

        try {
            ServerProperties serverProperties = payerAuthConfig(baseUrl, "smart-backend", null, "provider-ri");
            SmartClientKeyService keyService = new SmartClientKeyService();
            keyService.init();

            B2BTokenService service = newBackendServicesTestService(serverProperties, keyService,
                new SmartClientDiscoveryService(newTestSecurityProperties(), new OutboundTargetValidator(newTestSecurityProperties())));

            String token = service.getTokenForServer(baseUrl, List.of("system/*.rs"));

            assertEquals("backend-tok", token);
            String body = capturedBody.get();
            assertNotNull(body);
            String assertion = extractFormParam(body, "client_assertion");
            SignedJWT parsed = SignedJWT.parse(assertion);
            assertEquals(JWSAlgorithm.ES384, parsed.getHeader().getAlgorithm());
        } finally {
            server.stop(0);
        }
    }

    private static SecurityProperties newTestSecurityProperties() {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(false);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        props.setServerBaseUrl("http://localhost:8080");
        return props;
    }

    private static B2BTokenService newBackendServicesTestService(
            SmartClientKeyService keyService, SmartClientDiscoveryService discovery) {
        return newBackendServicesTestService(new ServerProperties(), keyService, discovery);
    }

    private static B2BTokenService newBackendServicesTestService(
            ServerProperties serverProperties, SmartClientKeyService keyService, SmartClientDiscoveryService discovery) {
        SecurityProperties props = newTestSecurityProperties();
        return new B2BTokenService(
            new CertificateHolder(props), props, new OutboundTargetValidator(props),
            serverProperties, keyService, discovery);
    }

    private static ServerProperties payerAuthConfig(String fhirUrl, String authType, String tokenUrl, String clientId) {
        ServerProperties.PayerServer payer = new ServerProperties.PayerServer();
        payer.setFhirUrl(fhirUrl);
        payer.setAuthType(authType);
        payer.setTokenUrl(tokenUrl);
        payer.setClientId(clientId);
        ServerProperties serverProperties = new ServerProperties();
        serverProperties.setPayerServers(List.of(payer));
        return serverProperties;
    }

    private static String extractFormParam(String formBody, String name) {
        for (String pair : formBody.split("&")) {
            int idx = pair.indexOf('=');
            if (idx > 0 && pair.substring(0, idx).equals(name)) {
                return URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8);
            }
        }
        throw new AssertionError("Missing form param: " + name);
    }

    private static String bodyOf(HttpRequest request) throws Exception {
        HttpRequest.BodyPublisher publisher = request.bodyPublisher().orElseThrow();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        CountDownLatch latch = new CountDownLatch(1);
        publisher.subscribe(new Flow.Subscriber<ByteBuffer>() {
            public void onSubscribe(Flow.Subscription subscription) {
                subscription.request(Long.MAX_VALUE);
            }

            public void onNext(ByteBuffer item) {
                byte[] bytes = new byte[item.remaining()];
                item.get(bytes);
                out.writeBytes(bytes);
            }

            public void onError(Throwable throwable) {
                latch.countDown();
            }

            public void onComplete() {
                latch.countDown();
            }
        });
        latch.await();
        return out.toString(StandardCharsets.UTF_8);
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes();
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
