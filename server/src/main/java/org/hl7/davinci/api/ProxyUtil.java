package org.hl7.davinci.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.hl7.davinci.security.B2BTokenService;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SecurityUtil;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.springframework.http.ResponseEntity;

/**
 * Shared utilities for proxy controllers.
 */
public final class ProxyUtil {

    public static final List<String> DTR_SCOPES = List.of(
        "system/Questionnaire.rs", "system/ValueSet.rs", "system/Library.rs");

    public static final List<String> PAS_SCOPES = List.of(
        "system/Claim.crus", "system/ClaimResponse.rs");

    public static final List<String> FHIR_READ_SCOPES = List.of("system/*.read");

    private ProxyUtil() {}

    /**
     * Extracts a required non-blank string parameter from a request body map.
     * @throws IllegalArgumentException if the key is missing or blank
     */
    public static String getRequiredParam(Map<String, Object> params, String key) {
        Object value = params.get(key);
        if (value == null || (value instanceof String s && s.isBlank())) {
            throw new IllegalArgumentException(key + " is required");
        }
        return value.toString();
    }

    /**
     * Sends an authenticated POST to the payer FHIR server and returns the response.
     */
    public static ResponseEntity<String> relayPostToPayerFhir(
            String operationUrl, String payerFhirUrl, String requestBody,
            List<String> scopes, B2BTokenService b2bTokenService,
            SecurityProperties securityProperties, Logger logger) throws Exception {

        String token = b2bTokenService.getTokenForServer(
            UrlMatchUtil.normalizeUrl(payerFhirUrl), scopes);

        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
            .uri(URI.create(operationUrl))
            .header("Content-Type", "application/fhir+json")
            .header("Accept", "application/fhir+json")
            .timeout(Duration.ofSeconds(30))
            .POST(HttpRequest.BodyPublishers.ofString(requestBody));

        if (token != null) {
            reqBuilder.header("Authorization", "Bearer " + token);
        }

        HttpClient client = SecurityUtil.getHttpClient(securityProperties);
        HttpResponse<String> upstream = client.send(
            reqBuilder.build(), HttpResponse.BodyHandlers.ofString());

        if (upstream.statusCode() != 200) {
            logger.warn("Payer request failed at {}: HTTP {} {}",
                operationUrl, upstream.statusCode(), upstream.body());
        }

        return ResponseEntity.status(upstream.statusCode())
            .header("Content-Type", "application/fhir+json")
            .body(upstream.body());
    }

    /**
     * Sends an authenticated GET to the payer FHIR server and returns the response.
     */
    public static ResponseEntity<String> relayGetToPayerFhir(
            String url, String payerFhirUrl, List<String> scopes,
            B2BTokenService b2bTokenService,
            SecurityProperties securityProperties, Logger logger) throws Exception {

        String token = b2bTokenService.getTokenForServer(
            UrlMatchUtil.normalizeUrl(payerFhirUrl), scopes);

        HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("Accept", "application/fhir+json")
            .timeout(Duration.ofSeconds(15))
            .GET();

        if (token != null) {
            reqBuilder.header("Authorization", "Bearer " + token);
        }

        HttpClient client = SecurityUtil.getHttpClient(securityProperties);
        HttpResponse<String> upstream = client.send(
            reqBuilder.build(), HttpResponse.BodyHandlers.ofString());

        if (upstream.statusCode() != 200) {
            logger.warn("Payer GET failed at {}: HTTP {} {}",
                url, upstream.statusCode(), upstream.body());
        }

        return ResponseEntity.status(upstream.statusCode())
            .header("Content-Type", "application/fhir+json")
            .body(upstream.body());
    }
}
