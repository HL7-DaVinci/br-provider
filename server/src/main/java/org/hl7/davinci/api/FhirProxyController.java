package org.hl7.davinci.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Set;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.B2BTokenService;
import org.hl7.davinci.security.CertificateHolder;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SecurityUtil;
import org.hl7.davinci.security.SpaAuthController;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import static org.springframework.web.bind.annotation.RequestMethod.*;

/**
 * BFF proxy that routes FHIR requests through the server with token injection.
 * The SPA wraps absolute FHIR URLs through this proxy; the proxy validates the
 * target against a trusted server allowlist and injects the appropriate token.
 *
 * Two auth strategies based on target:
 *   - Provider servers: session token from authorization_code flow (user auth)
 *   - Payer servers: B2B token from client_credentials flow (system auth)
 *
 * The allowlist includes:
 *   - Static: configured trusted provider base URLs from ServerProperties
 *   - Static: configured payer server FHIR URLs from ServerProperties
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

    private static final List<String> PAYER_B2B_SCOPES = ProxyUtil.FHIR_READ_SCOPES;

    private final SecurityProperties securityProperties;
    private final ServerProperties serverProperties;
    private final B2BTokenService b2bTokenService;
    private final CertificateHolder certificateHolder;

    public FhirProxyController(SecurityProperties securityProperties,
            ServerProperties serverProperties,
            B2BTokenService b2bTokenService,
            CertificateHolder certificateHolder) {
        this.securityProperties = securityProperties;
        this.serverProperties = serverProperties;
        this.b2bTokenService = b2bTokenService;
        this.certificateHolder = certificateHolder;
    }

    @RequestMapping(method = {GET, POST, PUT, DELETE, PATCH})
    public void proxy(
            @RequestParam("url") String targetUrl,
            @RequestParam(name = "payer", required = false, defaultValue = "false") boolean payerAuth,
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

        // Auth strategy determined by caller intent (payer param), not URL matching.
        // This allows a single server to serve both provider and payer roles.
        String token;
        if (payerAuth) {
            String payerBaseUrl = serverProperties.getPayerFhirBaseUrl(targetUrl);
            token = b2bTokenService.getTokenForServer(payerBaseUrl, PAYER_B2B_SCOPES);
            if (token != null) {
                logger.debug("Payer proxy: using B2B client_credentials for {}", payerBaseUrl);
            }
        } else {
            SpaAuthController.refreshTokenIfNeeded(session, securityProperties, certificateHolder);
            token = SpaAuthController.getTokenForServer(session, targetUrl);
        }
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
     * Checks provider servers, payer servers, and the custom session server.
     */
    private boolean isAllowedTarget(URI uri, HttpSession session) {
        String target = uri.toString();

        // Provider FHIR servers (static allowlist)
        for (String baseUrl : serverProperties.getTrustedProviderUrls()) {
            if (UrlMatchUtil.matchesBaseUrl(target, baseUrl)) return true;
        }

        // Payer FHIR servers (static allowlist)
        if (serverProperties.isPayerFhirUrl(target)) return true;

        // Custom server from current session (dynamic)
        if (session != null) {
            String sessionServer = (String) session.getAttribute(
                SpaAuthController.SESSION_SERVER_URL);
            if (sessionServer != null
                    && UrlMatchUtil.matchesBaseUrl(target, sessionServer)) {
                return true;
            }
        }

        return false;
    }

}
