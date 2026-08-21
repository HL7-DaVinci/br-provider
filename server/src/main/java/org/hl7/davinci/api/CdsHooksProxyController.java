package org.hl7.davinci.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.CdsClientJwtService;
import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SecurityUtil;
import org.hl7.davinci.security.SessionTokenService;
import org.hl7.davinci.util.ForwardedHeaderUtil;
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

    private static final String ACCEPT_HEADER = "Accept";
    private static final String CONTENT_TYPE_HEADER = "Content-Type";
    private static final String APPLICATION_JSON = "application/json";
    private static final String ERROR_KEY = "error";

    private static final List<String> US_CORE_RESOURCE_TYPES = List.of(
        "AllergyIntolerance", "CarePlan", "CareTeam", "Condition", "Device",
        "DiagnosticReport", "DocumentReference", "Encounter", "Goal",
        "Immunization", "Location", "Medication", "MedicationRequest",
        "Observation", "Organization", "Patient", "Practitioner",
        "PractitionerRole", "Procedure", "Provenance");

    private final CdsClientJwtService cdsClientJwtService;
    private final SecurityProperties securityProperties;
    private final ServerProperties serverProperties;
    private final OutboundTargetValidator outboundTargetValidator;
    private final ObjectMapper objectMapper;

    public CdsHooksProxyController(
            CdsClientJwtService cdsClientJwtService,
            SecurityProperties securityProperties,
            ServerProperties serverProperties,
            OutboundTargetValidator outboundTargetValidator,
            ObjectMapper objectMapper) {
        this.cdsClientJwtService = cdsClientJwtService;
        this.securityProperties = securityProperties;
        this.serverProperties = serverProperties;
        this.outboundTargetValidator = outboundTargetValidator;
        this.objectMapper = objectMapper;
    }

    /**
     * Discovery: fetches available CDS services from the payer's CDS endpoint.
     * Returns the payer's discovery document as-is.
     */
    @GetMapping
    public ResponseEntity<Object> discoverServices(@RequestParam("server") String server,
            HttpServletRequest request) {
        try {
            var forwarded = ForwardedHeaderUtil.extract(request);
            String discoveryUrl = UrlMatchUtil.normalizeUrl(server);
            outboundTargetValidator.validate(discoveryUrl);

            String clientJwt = cdsClientJwtService.createClientJwt(discoveryUrl);

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(discoveryUrl))
                .timeout(Duration.ofSeconds(15))
                .GET();

            if (!forwarded.contains(ACCEPT_HEADER)) {
                reqBuilder.header(ACCEPT_HEADER, APPLICATION_JSON);
            }

            if (clientJwt != null && !forwarded.hasAuthorization()) {
                reqBuilder.header("Authorization", "Bearer " + clientJwt);
            }

            forwarded.headers().forEach(reqBuilder::header);

            HttpClient client = SecurityUtil.getHttpClient(securityProperties);
            HttpResponse<String> upstream = client.send(
                reqBuilder.build(), HttpResponse.BodyHandlers.ofString());
            int status = upstream.statusCode();

            if (status != 200) {
                logger.warn("CDS discovery failed for {}: HTTP {}", discoveryUrl, status);
                return ResponseEntity.status(status)
                    .body(Map.of(ERROR_KEY, "CDS discovery failed: HTTP " + status));
            }

            return ResponseEntity.ok()
                .header(CONTENT_TYPE_HEADER, APPLICATION_JSON)
                .body(upstream.body());

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of(ERROR_KEY, e.getMessage()));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            logger.error("CDS discovery interrupted for server={}", server);
            return ResponseEntity.status(502)
                .body(Map.of(ERROR_KEY, "Failed to reach CDS service"));
        } catch (Exception e) {
            logger.error("CDS discovery error for server={}: {}", server, e.getMessage());
            return ResponseEntity.status(502)
                .body(Map.of(ERROR_KEY, "Failed to reach CDS service"));
        }
    }

    /**
     * Relay: forwards a CDS hook request to the payer's CDS service.
     * Enriches the request body with fhirAuthorization (so the payer can
     * callback to this server for prefetch data) and signs the request with
     * a CDS client JWT in the Authorization header.
     */
    @PostMapping("/{serviceId}")
    public ResponseEntity<Object> invokeHook(
            @PathVariable("serviceId") String serviceId,
            @RequestParam("server") String server,
            @RequestBody Map<String, Object> hookRequest,
            HttpServletRequest request) {
        try {
            var forwarded = ForwardedHeaderUtil.extract(request);
            String serviceUrl = UrlMatchUtil.normalizeUrl(server) + "/" + serviceId;
            outboundTargetValidator.validate(UrlMatchUtil.normalizeUrl(server));

            // Enrich the hook request with fhirAuthorization for payer prefetch callbacks
            var session = request.getSession(false);
            String accessToken = (session != null)
                ? (String) session.getAttribute(SessionTokenService.SESSION_ACCESS_TOKEN) : null;
            String fhirServerBase = ProxyUtil.getActiveProviderFhirBase(
                request, serverProperties);

            hookRequest.put("fhirServer", fhirServerBase);

            // CRD conformance: clients must state the CRD version they expect.
            Object extension = hookRequest.get("extension");
            if (!(extension instanceof Map)) {
                extension = new LinkedHashMap<String, Object>();
                hookRequest.put("extension", extension);
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> extensionMap = (Map<String, Object>) extension;
            extensionMap.putIfAbsent("davinci-crd.requestedVersion", "2.2");

            if (accessToken != null) {
                String grantedScope = (String) session.getAttribute(SessionTokenService.SESSION_GRANTED_SCOPE);
                Map<String, Object> fhirAuth = new LinkedHashMap<>();
                fhirAuth.put("access_token", accessToken);
                fhirAuth.put("token_type", "Bearer");
                fhirAuth.put("expires_in", 300);
                fhirAuth.put("scope", narrowedHookScope(grantedScope));
                fhirAuth.put("subject", resolveSubject(session));
                hookRequest.put("fhirAuthorization", fhirAuth);
            }

            String clientJwt = cdsClientJwtService.createClientJwt(serviceUrl);

            String body = objectMapper.writeValueAsString(hookRequest);

            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(serviceUrl))
                .timeout(Duration.ofSeconds(30))
                .POST(HttpRequest.BodyPublishers.ofString(body));

            if (!forwarded.contains(CONTENT_TYPE_HEADER)) {
                reqBuilder.header(CONTENT_TYPE_HEADER, APPLICATION_JSON);
            }
            if (!forwarded.contains(ACCEPT_HEADER)) {
                reqBuilder.header(ACCEPT_HEADER, APPLICATION_JSON);
            }

            if (clientJwt != null && !forwarded.hasAuthorization()) {
                reqBuilder.header("Authorization", "Bearer " + clientJwt);
            }

            forwarded.headers().forEach(reqBuilder::header);

            HttpClient client = SecurityUtil.getHttpClient(securityProperties);
            HttpResponse<String> upstream = client.send(
                reqBuilder.build(), HttpResponse.BodyHandlers.ofString());
            int status = upstream.statusCode();
            String upstreamBody = upstream.body();

            if (status != 200) {
                logger.warn("CDS hook {} failed at {}: HTTP {} {}",
                    serviceId, serviceUrl, status, upstreamBody);
                return ResponseEntity.status(status)
                    .header(CONTENT_TYPE_HEADER, APPLICATION_JSON)
                    .body(upstreamBody);
            }

            return ResponseEntity.ok()
                .header(CONTENT_TYPE_HEADER, APPLICATION_JSON)
                .body(upstreamBody);

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of(ERROR_KEY, e.getMessage()));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            logger.error("CDS hook {} relay interrupted for server={}", serviceId, server);
            return ResponseEntity.status(502)
                .body(Map.of(ERROR_KEY, "Failed to relay CDS hook request"));
        } catch (Exception e) {
            logger.error("CDS hook {} relay error for server={}: {}", serviceId, server, e.getMessage());
            return ResponseEntity.status(502)
                .body(Map.of(ERROR_KEY, "Failed to relay CDS hook request"));
        }
    }

    /**
     * Builds the advertised fhirAuthorization scope. CRD requires the scopes to be as narrow
     * as feasible, so the CDS service is offered read and search on the US Core resource
     * types only. Token enforcement reads the JWT scope claim, not this string.
     */
    private static String narrowedHookScope(String grantedScope) {
        String level = grantedScope != null && grantedScope.contains("patient/") ? "patient" : "user";
        return US_CORE_RESOURCE_TYPES.stream()
            .map(type -> level + "/" + type + ".rs")
            .collect(Collectors.joining(" "));
    }

    /**
     * Resolves the subject identifier for fhirAuthorization from the session's
     * userinfo claims.
     */
    @SuppressWarnings("unchecked")
    private String resolveSubject(jakarta.servlet.http.HttpSession session) {
        if (session == null) return "";
        Map<String, String> userInfo = (Map<String, String>) session.getAttribute(
            SessionTokenService.SESSION_USERINFO);
        if (userInfo != null && userInfo.containsKey("fhirUser")) {
            return userInfo.get("fhirUser");
        }
        return "";
    }
}
