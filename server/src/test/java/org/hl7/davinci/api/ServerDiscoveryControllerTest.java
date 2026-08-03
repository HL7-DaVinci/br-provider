package org.hl7.davinci.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SmartClientDiscoveryService;
import org.hl7.davinci.security.SmartClientDiscoveryService.SmartConfiguration;
import org.hl7.davinci.security.UdapClientRegistration;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import com.sun.net.httpserver.HttpServer;

class ServerDiscoveryControllerTest {

    private static HttpServer startFhirMetadataServer() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/fhir/metadata", exchange -> {
            byte[] body = "{\"resourceType\":\"CapabilityStatement\"}"
                .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/fhir+json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        server.start();
        return server;
    }

    @Test
    void forwardsPendingHeadersToCapabilityStatementRequest() throws Exception {
        var receivedApiKey = new AtomicReference<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/fhir/metadata", exchange -> {
            receivedApiKey.set(exchange.getRequestHeaders().getFirst("X-Api-Key"));
            byte[] body = "{\"resourceType\":\"CapabilityStatement\"}"
                .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/fhir+json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        server.start();

        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/fhir";
            var udapClient = mock(UdapClientRegistration.class);
            when(udapClient.discoverAndRegister(baseUrl))
                .thenReturn(new UdapClientRegistration.DiscoveryResult(
                    false, null, null, false, false));
            var smartClient = mock(SmartClientDiscoveryService.class);
            when(smartClient.discover(baseUrl)).thenThrow(new IllegalStateException("no smart configuration"));
            var securityProperties = new SecurityProperties();
            var controller = new ServerDiscoveryController(
                udapClient,
                new OutboundTargetValidator(securityProperties),
                securityProperties,
                smartClient,
                new ServerProperties("http://localhost:8080/fhir", List.of()));
            var request = new MockHttpServletRequest();
            request.addHeader("X-Fwd-X-Api-Key", "secret");

            var response = controller.discover(baseUrl, request);

            assertTrue((Boolean) response.getBody().get("fhirServer"));
            assertEquals("secret", receivedApiKey.get());
            verify(udapClient).discoverAndRegister(baseUrl);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void discoveryReportsSmartWhenUdapAbsent() throws Exception {
        var server = startFhirMetadataServer();

        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/fhir";
            var udapClient = mock(UdapClientRegistration.class);
            when(udapClient.discoverAndRegister(baseUrl))
                .thenReturn(new UdapClientRegistration.DiscoveryResult(
                    false, null, null, false, false));

            var smartClient = mock(SmartClientDiscoveryService.class);
            var smartConfig = new SmartConfiguration(
                "https://ehr.example.com/oauth/authorize",
                "https://ehr.example.com/oauth/token",
                List.of("launch-ehr"),
                List.of("authorization_code"),
                List.of("S256"),
                List.of("private_key_jwt"),
                List.of("RS384"),
                "https://ehr.example.com",
                "https://ehr.example.com/jwks");
            when(smartClient.discover(baseUrl)).thenReturn(smartConfig);

            var provider = new ServerProperties.ProviderServer();
            provider.setName("EHR");
            provider.setUrl(baseUrl);
            provider.setUserClientId("spa-client");
            var serverProperties = new ServerProperties("http://localhost:8080/fhir", List.of(provider));

            var securityProperties = new SecurityProperties();
            var controller = new ServerDiscoveryController(
                udapClient,
                new OutboundTargetValidator(securityProperties),
                securityProperties,
                smartClient,
                serverProperties);
            var request = new MockHttpServletRequest();

            Map<String, Object> body = controller.discover(baseUrl, request).getBody();

            assertEquals(true, body.get("smartEnabled"));
            assertEquals(true, body.get("userLoginConfigured"));
            assertEquals("https://ehr.example.com/oauth/authorize", body.get("smartAuthorizationEndpoint"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void discoveryReportsSmartDisabledForBackendServicesOnlyMetadata() throws Exception {
        var server = startFhirMetadataServer();

        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/fhir";
            var udapClient = mock(UdapClientRegistration.class);
            when(udapClient.discoverAndRegister(baseUrl))
                .thenReturn(new UdapClientRegistration.DiscoveryResult(
                    false, null, null, false, false));

            var smartClient = mock(SmartClientDiscoveryService.class);
            var smartConfig = new SmartConfiguration(
                null,
                "https://ehr.example.com/oauth/token",
                List.of("client-confidential-asymmetric"),
                List.of("client_credentials"),
                List.of(),
                List.of("private_key_jwt"),
                List.of("RS384"),
                "https://ehr.example.com",
                "https://ehr.example.com/jwks");
            when(smartClient.discover(baseUrl)).thenReturn(smartConfig);

            var securityProperties = new SecurityProperties();
            var controller = new ServerDiscoveryController(
                udapClient,
                new OutboundTargetValidator(securityProperties),
                securityProperties,
                smartClient,
                new ServerProperties("http://localhost:8080/fhir", List.of()));
            var request = new MockHttpServletRequest();

            Map<String, Object> body = controller.discover(baseUrl, request).getBody();

            assertEquals(false, body.get("smartEnabled"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void discoveryReportsSmartDisabledOnFetchFailure() throws Exception {
        var server = startFhirMetadataServer();

        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/fhir";
            var udapClient = mock(UdapClientRegistration.class);
            when(udapClient.discoverAndRegister(baseUrl))
                .thenReturn(new UdapClientRegistration.DiscoveryResult(
                    false, null, null, false, false));

            var smartClient = mock(SmartClientDiscoveryService.class);
            when(smartClient.discover(baseUrl))
                .thenThrow(new IllegalStateException("SMART configuration fetch failed"));

            var securityProperties = new SecurityProperties();
            var controller = new ServerDiscoveryController(
                udapClient,
                new OutboundTargetValidator(securityProperties),
                securityProperties,
                smartClient,
                new ServerProperties("http://localhost:8080/fhir", List.of()));
            var request = new MockHttpServletRequest();

            Map<String, Object> body = controller.discover(baseUrl, request).getBody();

            assertEquals(false, body.get("smartEnabled"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void acceptsSmartServerWhenCapabilityStatementFails() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/fhir/metadata", exchange -> {
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });
        server.start();

        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/fhir";
            var udapClient = mock(UdapClientRegistration.class);
            var smartClient = mock(SmartClientDiscoveryService.class);
            var smartConfig = new SmartConfiguration(
                "https://ehr.example.com/oauth/authorize",
                "https://ehr.example.com/oauth/token",
                List.of("launch-standalone"),
                List.of("authorization_code"),
                List.of("S256"),
                List.of("none"),
                List.of(),
                "https://ehr.example.com",
                "https://ehr.example.com/jwks");
            when(smartClient.discover(baseUrl)).thenReturn(smartConfig);

            var securityProperties = new SecurityProperties();
            var controller = new ServerDiscoveryController(
                udapClient,
                new OutboundTargetValidator(securityProperties),
                securityProperties,
                smartClient,
                new ServerProperties("http://localhost:8080/fhir", List.of()));

            Map<String, Object> body =
                controller.discover(baseUrl, new MockHttpServletRequest()).getBody();

            assertEquals(true, body.get("fhirServer"));
            assertEquals(true, body.get("smartEnabled"));
            assertEquals(null, body.get("error"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void reportsFailureWhenCapabilityStatementAndSmartBothFail() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/fhir/metadata", exchange -> {
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });
        server.start();

        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/fhir";
            var udapClient = mock(UdapClientRegistration.class);
            var smartClient = mock(SmartClientDiscoveryService.class);
            when(smartClient.discover(baseUrl))
                .thenThrow(new IllegalStateException("no smart configuration"));

            var securityProperties = new SecurityProperties();
            var controller = new ServerDiscoveryController(
                udapClient,
                new OutboundTargetValidator(securityProperties),
                securityProperties,
                smartClient,
                new ServerProperties("http://localhost:8080/fhir", List.of()));

            Map<String, Object> body =
                controller.discover(baseUrl, new MockHttpServletRequest()).getBody();

            assertEquals(false, body.get("fhirServer"));
            assertTrue(body.get("error").toString().contains("500"));
        } finally {
            server.stop(0);
        }
    }
}
