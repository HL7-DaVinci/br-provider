package org.hl7.davinci.api;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpServer;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.CdsClientJwtService;
import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.security.SecurityProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CdsHooksProxyControllerTest {

    HttpServer upstream;
    AtomicReference<Headers> received;
    CdsHooksProxyController controller;
    CdsClientJwtService jwtService;

    @BeforeEach
    void setUp() throws IOException {
        received = new AtomicReference<>();
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/cds-services", exchange -> {
            received.set(exchange.getRequestHeaders());
            byte[] body = "{\"services\":[]}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        upstream.start();

        var securityProperties = new SecurityProperties();
        securityProperties.setSslVerify(false);
        jwtService = mock(CdsClientJwtService.class);
        var targetValidator = mock(OutboundTargetValidator.class);
        controller = new CdsHooksProxyController(
            jwtService, securityProperties,
            new ServerProperties("http://fhir.test/fhir", null),
            targetValidator, new ObjectMapper());
    }

    @AfterEach
    void tearDown() {
        upstream.stop(0);
    }

    private String upstreamUrl() {
        return "http://127.0.0.1:" + upstream.getAddress().getPort() + "/cds-services";
    }

    @Test
    void discovery_forwardsCustomHeaders() {
        var request = new MockHttpServletRequest();
        request.addHeader("X-Fwd-X-Api-Key", "abc");

        var response = controller.discoverServices(upstreamUrl(), request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals("abc", received.get().getFirst("X-Api-Key"));
    }

    @Test
    void discovery_forwardedAcceptReplacesDefaultInsteadOfDuplicating() {
        var request = new MockHttpServletRequest();
        request.addHeader("X-Fwd-Accept", "application/json");

        var response = controller.discoverServices(upstreamUrl(), request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals(java.util.List.of("application/json"), received.get().get("Accept"));
    }

    @Test
    void invokeHook_forwardedAuthorizationReplacesClientJwt() {
        when(jwtService.createClientJwt(anyString())).thenReturn("client-jwt");
        var request = new MockHttpServletRequest();
        request.addHeader("X-Fwd-Authorization", "Bearer static-token");

        var response = controller.invokeHook(
            "svc", upstreamUrl(), new java.util.HashMap<>(Map.of("hook", "order-sign")), request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals("Bearer static-token", received.get().getFirst("Authorization"));
    }
}
