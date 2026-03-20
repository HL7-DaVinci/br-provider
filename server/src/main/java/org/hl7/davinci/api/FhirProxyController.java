package org.hl7.davinci.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Set;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SecurityUtil;
import org.hl7.davinci.security.SpaAuthController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import static org.springframework.web.bind.annotation.RequestMethod.*;

/**
 * BFF proxy that routes FHIR requests through the server with token injection.
 * The SPA wraps absolute FHIR URLs through this proxy; the proxy injects the
 * access token from the server-side session and forwards allowed headers.
 */
@RestController
@RequestMapping("/api/fhir-proxy")
public class FhirProxyController {

    private static final Logger logger = LoggerFactory.getLogger(FhirProxyController.class);

    private static final Set<String> FORWARDED_HEADERS = Set.of(
        "accept", "content-type", "prefer", "if-match", "if-none-match",
        "x-bypass-auth"
    );

    private final SecurityProperties securityProperties;

    public FhirProxyController(SecurityProperties securityProperties) {
        this.securityProperties = securityProperties;
    }

    @RequestMapping(method = {GET, POST, PUT, DELETE, PATCH})
    public void proxy(
            @RequestParam("url") String targetUrl,
            HttpServletRequest request,
            HttpServletResponse response) throws Exception {

        URI target;
        try {
            target = URI.create(targetUrl);
        } catch (IllegalArgumentException e) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid target URL");
            return;
        }

        if (!isAllowedTarget(target)) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Target URL not allowed");
            return;
        }

        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder().uri(target);

        // Inject token from session when available; the target server
        // decides whether a given endpoint actually requires authentication.
        var session = request.getSession(false);
        String token = (session != null)
            ? (String) session.getAttribute(SpaAuthController.SESSION_ACCESS_TOKEN) : null;
        if (token != null) {
            reqBuilder.header("Authorization", "Bearer " + token);
        }

        // Forward allowed headers from the SPA request transparently
        for (String headerName : FORWARDED_HEADERS) {
            String value = request.getHeader(headerName);
            if (value != null) {
                reqBuilder.header(headerName, value);
            }
        }
        if (request.getHeader("Accept") == null) {
            reqBuilder.header("Accept", "application/fhir+json");
        }

        String method = request.getMethod();
        if ("POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method)) {
            byte[] body = request.getInputStream().readAllBytes();
            reqBuilder.method(method, HttpRequest.BodyPublishers.ofByteArray(body));
        } else if ("DELETE".equals(method)) {
            reqBuilder.DELETE();
        } else {
            reqBuilder.GET();
        }

        HttpClient client = SecurityUtil.getHttpClient(securityProperties);
        HttpResponse<byte[]> upstream = client.send(
            reqBuilder.build(), HttpResponse.BodyHandlers.ofByteArray());

        response.setStatus(upstream.statusCode());
        upstream.headers().firstValue("Content-Type")
            .ifPresent(ct -> response.setContentType(ct));
        response.getOutputStream().write(upstream.body());
    }

    private boolean isAllowedTarget(URI uri) {
        String scheme = uri.getScheme();
        return "http".equals(scheme) || "https".equals(scheme);
    }
}
