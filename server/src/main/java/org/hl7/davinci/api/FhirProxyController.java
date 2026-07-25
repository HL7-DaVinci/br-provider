package org.hl7.davinci.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.B2BTokenService;
import org.hl7.davinci.security.CertificateHolder;
import org.hl7.davinci.security.OutboundAuthService;
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

    // x-bypass-payor-check is this stack's own payer test header (see payer PlanDefinitionService);
    // it is only sent when the user enables the payor check bypass setting for a payer.
    private static final Set<String> FORWARDED_HEADERS = Set.of(
        "accept", "content-type", "prefer", "if-match", "if-none-match", "x-bypass-payor-check"
    );

    /** Headers that must not be forwarded through a proxy. */
    private static final Set<String> HOP_BY_HOP_HEADERS = Set.of(
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailers", "transfer-encoding", "upgrade",
        ":status" // HTTP/2 pseudo-header included by java.net.http
    );

    /** End-to-end response headers that must never be replayed on the BFF origin. */
    private static final Set<String> BLOCKED_RESPONSE_HEADERS = Set.of(
        "set-cookie", "set-cookie2"
    );

    private final SecurityProperties securityProperties;
    private final ServerProperties serverProperties;
    private final B2BTokenService b2bTokenService;
    private final CertificateHolder certificateHolder;
    private final OutboundAuthService outboundAuth;

    public FhirProxyController(SecurityProperties securityProperties,
            ServerProperties serverProperties,
            B2BTokenService b2bTokenService,
            CertificateHolder certificateHolder,
            OutboundAuthService outboundAuth) {
        this.securityProperties = securityProperties;
        this.serverProperties = serverProperties;
        this.b2bTokenService = b2bTokenService;
        this.certificateHolder = certificateHolder;
        this.outboundAuth = outboundAuth;
    }

    @RequestMapping(method = {GET, POST, PUT, DELETE, PATCH})
    public void proxy(
            @RequestParam("url") String targetUrl,
            @RequestParam(name = "payer", required = false, defaultValue = "false") boolean payerAuth,
            @RequestParam(name = "op", required = false, defaultValue = "read") String op,
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

        try {
            // Auth strategy determined by caller intent (payer param), not URL matching.
            // This allows a single server to serve both provider and payer roles.
            String token = null;
            boolean optimisticPayer = false;
            String payerBaseUrl = null;
            List<String> payerScopes = null;

            if (payerAuth) {
                payerBaseUrl = resolvePayerBaseUrl(targetUrl, session);
                try {
                    payerScopes = ProxyUtil.payerScopesForOp(op);
                } catch (IllegalArgumentException e) {
                    response.sendError(HttpServletResponse.SC_BAD_REQUEST, e.getMessage());
                    return;
                }
                switch (outboundAuth.modeFor(payerBaseUrl)) {
                    case OPEN -> logger.debug("Payer proxy: {} is open; forwarding without a token", payerBaseUrl);
                    case UDAP_B2B -> {
                        token = b2bTokenService.getTokenForServer(payerBaseUrl, payerScopes);
                        boolean bypassRequested = request.getHeader(securityProperties.getBypassHeader()) != null;
                        if (token == null && securityProperties.isEnableAuthentication() && !bypassRequested) {
                            logger.warn("Payer proxy: no B2B token obtainable for {}; refusing unauthenticated forward",
                                payerBaseUrl);
                            response.sendError(HttpServletResponse.SC_BAD_GATEWAY,
                                "Unable to obtain a B2B token for payer " + payerBaseUrl
                                + ". Check the payer's UDAP support or mark it requiresAuth: false / use "
                                + securityProperties.getBypassHeader() + " for open servers.");
                            return;
                        }
                        if (token != null) {
                            logger.debug("Payer proxy: using B2B client_credentials for {} (op={})",
                                payerBaseUrl, op);
                        }
                    }
                    case UNKNOWN -> optimisticPayer = true;
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
            // Prevent the shared HttpClient from caching upstream responses
            reqBuilder.header("Cache-Control", "no-store");

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
            HttpRequest httpRequest = reqBuilder.build();
            HttpResponse<byte[]> upstream = client.send(httpRequest, HttpResponse.BodyHandlers.ofByteArray());

            if (optimisticPayer && isAuthRejection(upstream.statusCode())) {
                outboundAuth.recordAuthRequired(payerBaseUrl);
                String retryToken = b2bTokenService.getTokenForServer(payerBaseUrl, payerScopes);
                if (retryToken != null) {
                    logger.info("Payer proxy: {} rejected tokenless request ({}); retrying with B2B token",
                        payerBaseUrl, upstream.statusCode());
                    HttpRequest retry = HttpRequest.newBuilder(httpRequest, (name, value) -> true)
                        .header("Authorization", "Bearer " + retryToken)
                        .build();
                    upstream = client.send(retry, HttpResponse.BodyHandlers.ofByteArray());
                }
            } else if (optimisticPayer && upstream.statusCode() < 500) {
                outboundAuth.recordOpen(payerBaseUrl);
            }

            response.setStatus(upstream.statusCode());
            upstream.headers().map().forEach((name, values) -> {
                if (shouldRelayResponseHeader(name)) {
                    for (String v : values) {
                        response.addHeader(name, v);
                    }
                }
            });
            response.getOutputStream().write(upstream.body());
        } catch (Exception e) {
            logger.error("FHIR proxy error relaying to {}: {}", targetUrl, e.getMessage(), e);
            if (!response.isCommitted()) {
                response.sendError(HttpServletResponse.SC_BAD_GATEWAY,
                    "Upstream FHIR request failed");
            }
        }
    }

    static boolean shouldRelayResponseHeader(String headerName) {
        String normalized = headerName.toLowerCase(Locale.ROOT);
        return !HOP_BY_HOP_HEADERS.contains(normalized)
            && !BLOCKED_RESPONSE_HEADERS.contains(normalized);
    }

    private static boolean isAuthRejection(int status) {
        return status == 401 || status == 403;
    }

    /**
     * Configured payer base if the target matches one; otherwise the session's active payer;
     * otherwise the target URL itself. The raw target is an imperfect auth-mode cache key, so it
     * is only the last resort.
     */
    private String resolvePayerBaseUrl(String targetUrl, HttpSession session) {
        String configured = serverProperties.getPayerFhirBaseUrl(targetUrl);
        if (!configured.equals(targetUrl)) {
            return configured;
        }
        if (session != null) {
            String sessionPayer = (String) session.getAttribute(SpaAuthController.SESSION_PAYER_FHIR_URL);
            if (sessionPayer != null && UrlMatchUtil.matchesBaseUrl(targetUrl, sessionPayer)) {
                return sessionPayer;
            }
        }
        return targetUrl;
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

        // Custom server / payer from current session (dynamic). Both are
        // user-selected via the settings dialog and pushed to the session
        // through /auth/active-server and /auth/active-payer respectively.
        if (session != null) {
            String sessionServer = (String) session.getAttribute(
                SpaAuthController.SESSION_SERVER_URL);
            if (sessionServer != null
                    && UrlMatchUtil.matchesBaseUrl(target, sessionServer)) {
                return true;
            }
            String sessionPayer = (String) session.getAttribute(
                SpaAuthController.SESSION_PAYER_FHIR_URL);
            if (sessionPayer != null
                    && UrlMatchUtil.matchesBaseUrl(target, sessionPayer)) {
                return true;
            }
        }

        return false;
    }

}
