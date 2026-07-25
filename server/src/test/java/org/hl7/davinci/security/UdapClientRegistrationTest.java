package org.hl7.davinci.security;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class UdapClientRegistrationTest {

    private static final String TEST_CERT_PATH = "src/test/resources/test-cert.pfx";
    private static final String TEST_CERT_PASSWORD = "testpass";

    SecurityProperties props;

    @BeforeEach
    void setUp() {
        props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setIssuer("https://localhost:5001");
    }

    @Test
    void initialState_notRegistered() throws Exception {
        CertificateHolder cert = testCertificateHolder();

        UdapClientRegistration reg = new UdapClientRegistration(
            props, cert, new OutboundTargetValidator(props));

        assertFalse(reg.isRegistered());
        assertNull(reg.getClientId());
        assertNull(reg.getAuthorizeEndpoint());
        assertNull(reg.getTokenEndpoint());
        assertNull(reg.getRedirectUri());
    }

    @Test
    void startup_skipsWhenAuthDisabled() throws Exception {
        props.setEnableAuthentication(false);
        CertificateHolder cert = new UninitializedCertificateHolder();

        UdapClientRegistration reg = new UdapClientRegistration(
            props, cert, new OutboundTargetValidator(props));
        reg.onStartup();

        assertFalse(reg.isRegistered());
    }

    @Test
    void startup_skipsWhenCertNotInitialized() throws Exception {
        CertificateHolder cert = new UninitializedCertificateHolder();

        UdapClientRegistration reg = new UdapClientRegistration(
            props, cert, new OutboundTargetValidator(props));
        reg.onStartup();

        assertFalse(reg.isRegistered());
    }

    @Test
    void discoverAndRegister_blocksPrivateTargetBeforeNetworkCall() {
        CertificateHolder cert = assertDoesNotThrow(UdapClientRegistrationTest::testCertificateHolder);
        UdapClientRegistration reg = new UdapClientRegistration(
            props, cert, new OutboundTargetValidator(props));

        UdapClientRegistration.DiscoveryResult result =
            reg.discoverAndRegister("http://169.254.169.254/fhir");

        assertFalse(result.udapEnabled());
        assertNull(result.issuer());
    }

    @Test
    void refreshRegistration_coalescesWithinCooldownAndFallsBackToCache() throws Exception {
        AtomicInteger registerCount = new AtomicInteger();

        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        String baseUrl = "http://localhost:" + server.getAddress().getPort();
        server.createContext("/.well-known/udap", exchange ->
            respond(exchange, 200, metadataJson(baseUrl)));
        server.createContext("/register", exchange -> respond(exchange, 201,
            "{\"client_id\":\"client-" + registerCount.incrementAndGet() + "\"}"));
        server.start();

        try {
            props.setIssuer(baseUrl);
            props.setServerBaseUrl("http://localhost:8080");
            props.setRegistrationCooldownSeconds(0);
            UdapClientRegistration reg = new UdapClientRegistration(
                props, testCertificateHolder(), new OutboundTargetValidator(props));

            reg.refreshRegistration();
            reg.refreshRegistration();

            assertTrue(reg.isRegistered());
            assertEquals("client-2", reg.getClientId());
            assertEquals(2, registerCount.get());

            props.setRegistrationCooldownSeconds(300);
            reg.refreshRegistration();
            assertEquals(2, registerCount.get(), "refresh within the cooldown should be a no-op");

            props.setRegistrationCooldownSeconds(0);
            server.stop(0);
            assertDoesNotThrow(reg::ensureFreshRegistration);
            assertEquals("client-2", reg.getClientId(),
                "cached registration should survive an unreachable issuer");
        } finally {
            server.stop(0);
        }
    }

    private static String metadataJson(String baseUrl) {
        return "{\"issuer\":\"" + baseUrl + "\","
            + "\"authorization_endpoint\":\"" + baseUrl + "/authorize\","
            + "\"token_endpoint\":\"" + baseUrl + "/token\","
            + "\"registration_endpoint\":\"" + baseUrl + "/register\"}";
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes();
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    @Test
    void scopeDefaults() {
        assertEquals("openid udap fhirUser profile offline_access", props.getScope());
        assertEquals("Da Vinci Provider", props.getClientName());
    }

    private static CertificateHolder testCertificateHolder() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(false);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        return new CertificateHolder(props);
    }

    private static class UninitializedCertificateHolder extends CertificateHolder {
        UninitializedCertificateHolder() throws Exception {
            super(uninitializedProps());
        }

        private static SecurityProperties uninitializedProps() {
            SecurityProperties props = new SecurityProperties();
            props.setEnableAuthentication(false);
            props.setCertFile(null);
            // ensureInitialized() now retries on demand; disable fetch so a retry
            // attempt (e.g. from onStartup's guard) fails fast instead of hitting
            // the network on the default issuer.
            props.setFetchCert(false);
            return props;
        }
    }
}
