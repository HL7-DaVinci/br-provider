package org.hl7.davinci.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.hl7.davinci.security.CdsClientJwtService;
import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SecurityUtil;
import org.hl7.davinci.security.SpaAuthController;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * BFF relay for CDS Hooks requests to a payer's CDS service.
 * Handles service discovery and hook invocation, injecting the CDS client JWT
 * for client identity and enriching hook requests with fhirAuthorization so
 * the payer can callback for prefetch data.
 *
 * @see <a href="https://cds-hooks.org/specification/current/">CDS Hooks Specification</a>
 */
@RestController
@RequestMapping("/api/cds-services")
public class CdsHooksProxyController {

    private static final Logger logger = LoggerFactory.getLogger(CdsHooksProxyController.class);

    private final CdsClientJwtService cdsClientJwtService;
    private final SecurityProperties securityProperties;
    private final OutboundTargetValidator outboundTargetValidator;
    private final ObjectMapper objectMapper;

    public CdsHooksProxyController(
            CdsClientJwtService cdsClientJwtService,
            SecurityProperties securityProperties,
            OutboundTargetValidator outboundTargetValidator,
            ObjectMapper objectMapper) {
        this.cdsClientJwtService = cdsClientJwtService;
        this.securityProperties = securityProperties;
        this.outboundTargetValidator = outboundTargetValidator;
        this.objectMapper = objectMapper;
    }

    /**
     * Discovery: fetches available CDS services from the payer's CDS endpoint.
     * Returns the payer's discovery document as-is.
     */
    @GetMapping
    public ResponseEntity<?> discoverServices(@RequestParam("server") String server,
            HttpServletRequest request) {
        try {
            String discoveryUrl = UrlMatchUtil.normalizeUrl(server);
            outboundTargetValidator.validate(discoveryUrl);

            String clientJwt = cdsClientJwtService.createClientJwt(discoveryUrl);

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(discoveryUrl))
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(15))
                .GET();

            if (clientJwt != null) {
                reqBuilder.header("Authorization", "Bearer " + clientJwt);
            }

            HttpClient client = SecurityUtil.getHttpClient(securityProperties);
            HttpResponse<String> upstream = client.send(
                reqBuilder.build(), HttpResponse.BodyHandlers.ofString());

            if (upstream.statusCode() != 200) {
                logger.warn("CDS discovery failed for {}: HTTP {}", discoveryUrl, upstream.statusCode());
                return ResponseEntity.status(upstream.statusCode())
                    .body(Map.of("error", "CDS discovery failed: HTTP " + upstream.statusCode()));
            }

            return ResponseEntity.ok()
                .header("Content-Type", "application/json")
                .body(upstream.body());

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("CDS discovery error for server={}: {}", server, e.getMessage());
            return ResponseEntity.status(502)
                .body(Map.of("error", "Failed to reach CDS service"));
        }
    }

    /**
     * Relay: forwards a CDS hook request to the payer's CDS service.
     * Enriches the request body with fhirAuthorization (so the payer can
     * callback to this server for prefetch data) and signs the request with
     * a CDS client JWT in the Authorization header.
     */
    @PostMapping("/{serviceId}")
    public ResponseEntity<?> invokeHook(
            @PathVariable("serviceId") String serviceId,
            @RequestParam("server") String server,
            @RequestBody Map<String, Object> hookRequest,
            HttpServletRequest request) {
        try {
            String serviceUrl = UrlMatchUtil.normalizeUrl(server) + "/" + serviceId;
            outboundTargetValidator.validate(UrlMatchUtil.normalizeUrl(server));

            // Enrich the hook request with fhirAuthorization for payer prefetch callbacks
            var session = request.getSession(false);
            String accessToken = (session != null)
                ? (String) session.getAttribute(SpaAuthController.SESSION_ACCESS_TOKEN) : null;

            if (accessToken != null) {
                String fhirServerBase = securityProperties.getProviderBaseUrl() + "/fhir";
                hookRequest.put("fhirServer", fhirServerBase);

                Map<String, Object> fhirAuth = new LinkedHashMap<>();
                fhirAuth.put("access_token", accessToken);
                fhirAuth.put("token_type", "Bearer");
                fhirAuth.put("expires_in", 300);
                fhirAuth.put("scope", securityProperties.getScope());
                fhirAuth.put("subject", resolveSubject(session));
                hookRequest.put("fhirAuthorization", fhirAuth);
            }

            String clientJwt = cdsClientJwtService.createClientJwt(serviceUrl);

            String body = objectMapper.writeValueAsString(hookRequest);

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(serviceUrl))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(30))
                .POST(HttpRequest.BodyPublishers.ofString(body));

            if (clientJwt != null) {
                reqBuilder.header("Authorization", "Bearer " + clientJwt);
            }

            HttpClient client = SecurityUtil.getHttpClient(securityProperties);
            HttpResponse<String> upstream = client.send(
                reqBuilder.build(), HttpResponse.BodyHandlers.ofString());

            if (upstream.statusCode() != 200) {
                logger.warn("CDS hook {} failed at {}: HTTP {} {}",
                    serviceId, serviceUrl, upstream.statusCode(), upstream.body());
                return ResponseEntity.status(upstream.statusCode())
                    .header("Content-Type", "application/json")
                    .body(upstream.body());
            }

            return ResponseEntity.ok()
                .header("Content-Type", "application/json")
                .body(upstream.body());

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("CDS hook {} relay error for server={}: {}", serviceId, server, e.getMessage());
            return ResponseEntity.status(502)
                .body(Map.of("error", "Failed to relay CDS hook request"));
        }
    }

    /**
     * Resolves the subject identifier for fhirAuthorization from the session's
     * userinfo claims.
     */
    @SuppressWarnings("unchecked")
    private String resolveSubject(jakarta.servlet.http.HttpSession session) {
        if (session == null) return "";
        Map<String, String> userInfo = (Map<String, String>) session.getAttribute(
            SpaAuthController.SESSION_USERINFO);
        if (userInfo != null && userInfo.containsKey("fhirUser")) {
            return userInfo.get("fhirUser");
        }
        return "";
    }
}
