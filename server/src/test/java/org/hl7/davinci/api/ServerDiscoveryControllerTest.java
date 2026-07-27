package org.hl7.davinci.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.UdapClientRegistration;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import com.sun.net.httpserver.HttpServer;

class ServerDiscoveryControllerTest {

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
            var securityProperties = new SecurityProperties();
            var controller = new ServerDiscoveryController(
                udapClient,
                new OutboundTargetValidator(securityProperties),
                securityProperties);
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
}
