package org.hl7.davinci.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SecurityUtil;
import org.hl7.davinci.security.UdapClientRegistration;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Discovery endpoint for FHIR servers. Validates the target is a FHIR server
 * by fetching its CapabilityStatement, then probes for UDAP support and performs
 * automatic Dynamic Client Registration when UDAP is available. Used by the
 * settings dialog when a user adds a custom server.
 */
@RestController
@RequestMapping("/api/servers")
public class ServerDiscoveryController {

    private static final Logger logger = LoggerFactory.getLogger(ServerDiscoveryController.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final UdapClientRegistration udapClient;
    private final OutboundTargetValidator outboundTargetValidator;
    private final SecurityProperties securityProperties;

    public ServerDiscoveryController(UdapClientRegistration udapClient,
            OutboundTargetValidator outboundTargetValidator,
            SecurityProperties securityProperties) {
        this.udapClient = udapClient;
        this.outboundTargetValidator = outboundTargetValidator;
        this.securityProperties = securityProperties;
    }

    /**
     * Validates a FHIR server by fetching its CapabilityStatement, then probes
     * for UDAP support and performs automatic DCR if available.
     * Idempotent: repeated calls for the same issuer skip DCR.
     */
    @GetMapping("/discover")
    public ResponseEntity<Map<String, Object>> discover(
            @RequestParam("url") String fhirServerUrl) {
        String normalizedUrl = UrlMatchUtil.normalizeUrl(fhirServerUrl);
        Map<String, Object> response = new LinkedHashMap<>();

        // Validate the URL points to a FHIR server before anything else
        String validationError = validateFhirServer(normalizedUrl);
        if (validationError != null) {
            response.put("fhirServer", false);
            response.put("error", validationError);
            response.put("udapEnabled", false);
            return ResponseEntity.ok(response);
        }

        response.put("fhirServer", true);

        UdapClientRegistration.DiscoveryResult result = udapClient.discoverAndRegister(fhirServerUrl);
        response.put("udapEnabled", result.udapEnabled());

        if (result.udapEnabled()) {
            response.put("issuer", result.issuer());
            response.put("authorizationEndpoint", result.authorizationEndpoint());
            response.put("registered", result.registered());
            response.put("tieredOauthSupported", result.tieredOauthSupported());
        }

        return ResponseEntity.ok(response);
    }

    /**
     * Fetches the CapabilityStatement at {baseUrl}/metadata to confirm the URL
     * is a valid FHIR server. Returns null on success, or an error message on failure.
     */
    private String validateFhirServer(String baseUrl) {
        try {
            outboundTargetValidator.validate(baseUrl);

            HttpClient client = SecurityUtil.getHttpClient(securityProperties);
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/metadata"))
                .header("Accept", "application/fhir+json, application/json")
                .GET()
                .timeout(Duration.ofSeconds(10))
                .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                logger.debug("FHIR metadata check returned HTTP {} for {}", response.statusCode(), baseUrl);
                return "CapabilityStatement request returned HTTP " + response.statusCode();
            }

            Map<String, Object> body = objectMapper.readValue(
                response.body(), new TypeReference<>() {});
            if (!"CapabilityStatement".equals(body.get("resourceType"))) {
                return "Response is not a FHIR CapabilityStatement";
            }

            return null;
        } catch (IllegalArgumentException e) {
            logger.debug("FHIR metadata target blocked for {}: {}", baseUrl, e.getMessage());
            return e.getMessage();
        } catch (Exception e) {
            logger.debug("FHIR metadata check failed for {}: {}", baseUrl, e.getMessage());
            return "Could not fetch CapabilityStatement from " + baseUrl + "/metadata";
        }
    }
}
