package org.hl7.davinci.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Set;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.hl7.davinci.config.FhirServerProperties;
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
 * The SPA wraps absolute FHIR URLs through this proxy; the proxy validates the
 * target against a trusted server allowlist and injects the access token
 * from the server-side session.
 *
 * The allowlist includes:
 *   - Static: configured trusted server base URLs from FhirServerProperties
 *   - Dynamic: the single custom server authenticated in the current session
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
    private final FhirServerProperties fhirServerProperties;

    public FhirProxyController(SecurityProperties securityProperties,
            FhirServerProperties fhirServerProperties) {
        this.securityProperties = securityProperties;
        this.fhirServerProperties = fhirServerProperties;
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

        String scheme = target.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST,
                "Target URL must use http or https");
            return;
        }

        var session = request.getSession(false);

        if (!isAllowedTarget(target, session)) {
            logger.warn("Proxy request blocked: {} not in trusted server list", targetUrl);
            response.sendError(HttpServletResponse.SC_FORBIDDEN,
                "Target URL not in trusted server list");
            return;
        }

        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder().uri(target);

        // Inject the per-server token from the session when available;
        // the target server decides whether a given endpoint requires authentication.
        String token = SpaAuthController.getTokenForServer(session, targetUrl);
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

    /**
     * Validates that the target URL is in the trusted server allowlist.
     * Checks static trusted URLs from configuration and the single custom
     * server authenticated in the current session.
     */
    private boolean isAllowedTarget(URI uri, HttpSession session) {
        String target = uri.toString();

        for (String baseUrl : fhirServerProperties.getTrustedBaseUrls()) {
            if (FhirServerProperties.matchesBaseUrl(target, baseUrl)) return true;
        }

        if (session != null) {
            String sessionServer = (String) session.getAttribute(
                SpaAuthController.SESSION_SERVER_URL);
            if (sessionServer != null
                    && FhirServerProperties.matchesBaseUrl(target, sessionServer)) {
                return true;
            }
        }

        return false;
    }
}
