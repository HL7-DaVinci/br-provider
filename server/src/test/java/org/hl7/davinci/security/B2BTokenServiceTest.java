package org.hl7.davinci.security;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

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
            new OutboundTargetValidator(props)
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
                new CertificateHolder(props), props, new OutboundTargetValidator(props));

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

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes();
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
