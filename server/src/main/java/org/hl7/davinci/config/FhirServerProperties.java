package org.hl7.davinci.config;

import java.util.LinkedHashSet;
import java.util.Set;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import jakarta.annotation.PostConstruct;

/**
 * Centralized configuration for trusted FHIR server URLs. Parses app.fhir.servers
 * JSON and the local server address into an allowlist used for SSRF protection
 * in the BFF proxy.
 */
@Component
public class FhirServerProperties {

    private static final Logger logger = LoggerFactory.getLogger(FhirServerProperties.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${app.fhir.servers:}")
    private String fhirServersJson;

    @Value("${hapi.fhir.server_address:http://localhost:8080/fhir}")
    private String localServerAddress;

    private Set<String> trustedBaseUrls;

    public FhirServerProperties() {}

    public FhirServerProperties(String localServerAddress, String fhirServersJson) {
        this.localServerAddress = localServerAddress;
        this.fhirServersJson = fhirServersJson;
        init();
    }

    @PostConstruct
    void init() {
        trustedBaseUrls = new LinkedHashSet<>();
        trustedBaseUrls.add(normalizeUrl(localServerAddress));

        if (fhirServersJson != null && !fhirServersJson.isBlank()) {
            try {
                JsonNode servers = objectMapper.readTree(fhirServersJson);
                if (servers.isArray()) {
                    for (JsonNode server : servers) {
                        JsonNode urlNode = server.get("url");
                        if (urlNode != null && urlNode.isTextual()) {
                            trustedBaseUrls.add(normalizeUrl(urlNode.asText()));
                        }
                    }
                }
            } catch (Exception e) {
                logger.warn("Failed to parse app.fhir.servers JSON: {}", e.getMessage());
            }
        }

        logger.info("Trusted FHIR server base URLs: {}", trustedBaseUrls);
    }

    public Set<String> getTrustedBaseUrls() {
        return trustedBaseUrls;
    }

    public String getServersJson() {
        return (fhirServersJson == null || fhirServersJson.isBlank()) ? "[]" : fhirServersJson;
    }

    public String getLocalServerAddress() {
        return normalizeUrl(localServerAddress);
    }

    /**
     * Checks whether a target URL matches a base URL with proper boundary detection,
     * preventing prefix collisions (e.g., base "http://example.com/fhir" must not
     * match target "http://example.com/fhir.evil.com/Patient").
     */
    public static boolean matchesBaseUrl(String target, String baseUrl) {
        if (!target.startsWith(baseUrl)) return false;
        if (target.length() == baseUrl.length()) return true;
        char next = target.charAt(baseUrl.length());
        return next == '/' || next == '?' || next == '#';
    }

    public static String normalizeUrl(String url) {
        return url.replaceAll("/+$", "");
    }
}
