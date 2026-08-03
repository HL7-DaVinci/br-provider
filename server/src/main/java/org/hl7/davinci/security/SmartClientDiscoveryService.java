package org.hl7.davinci.security;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Reads {@code {base}/.well-known/smart-configuration}. Results are cached
 * per normalized base URL for five minutes.
 */
@Component
public class SmartClientDiscoveryService {

    private static final Logger logger = LoggerFactory.getLogger(SmartClientDiscoveryService.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final Duration CACHE_TTL = Duration.ofMinutes(5);

    private final SecurityProperties securityProperties;
    private final OutboundTargetValidator outboundTargetValidator;
    private final ConcurrentHashMap<String, CacheEntry> cache = new ConcurrentHashMap<>();

    @Autowired
    public SmartClientDiscoveryService(
            SecurityProperties securityProperties, OutboundTargetValidator outboundTargetValidator) {
        this.securityProperties = securityProperties;
        this.outboundTargetValidator = outboundTargetValidator;
    }

    public SmartConfiguration discover(String fhirBaseUrl) throws Exception {
        String normalizedBase = UrlMatchUtil.normalizeUrl(fhirBaseUrl);
        CacheEntry cached = cache.get(normalizedBase);
        if (cached != null && Instant.now().isBefore(cached.fetchedAt.plus(CACHE_TTL))) {
            return cached.config;
        }

        // Cached entries were already validated on first fetch, so this only
        // runs on a cache miss, right before the outbound request.
        outboundTargetValidator.validate(normalizedBase);

        String discoveryUrl = normalizedBase + "/.well-known/smart-configuration";
        logger.info("Discovering SMART configuration from: {}", discoveryUrl);

        HttpClient httpClient = SecurityUtil.getHttpClient(securityProperties);
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(discoveryUrl))
            .header("Accept", "application/json")
            .timeout(Duration.ofSeconds(10))
            .GET()
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                "SMART configuration fetch failed: HTTP " + response.statusCode() + " from " + discoveryUrl);
        }

        SmartConfiguration config = parse(response.body(), normalizedBase);
        cache.put(normalizedBase, new CacheEntry(config, Instant.now()));
        return config;
    }

    static SmartConfiguration parse(String body, String fhirBaseUrl) {
        JsonNode node;
        try {
            node = objectMapper.readTree(body);
        } catch (Exception e) {
            throw new IllegalStateException("SMART configuration response is not valid JSON", e);
        }

        String tokenEndpoint = node.path("token_endpoint").asText(null);
        if (tokenEndpoint == null || tokenEndpoint.isBlank()) {
            throw new IllegalStateException("SMART configuration is missing required token_endpoint");
        }

        return new SmartConfiguration(
            resolveEndpoint(node.path("authorization_endpoint").asText(null), fhirBaseUrl),
            resolveEndpoint(tokenEndpoint, fhirBaseUrl),
            readStringList(node, "capabilities"),
            readStringList(node, "grant_types_supported"),
            readStringList(node, "code_challenge_methods_supported"),
            readStringList(node, "token_endpoint_auth_methods_supported"),
            readStringList(node, "token_endpoint_auth_signing_alg_values_supported"),
            node.path("issuer").asText(null),
            node.path("jwks_uri").asText(null)
        );
    }

    static String resolveEndpoint(String url, String fhirBaseUrl) {
        if (url == null || url.isBlank()) {
            return null;
        }
        if (url.startsWith("http")) {
            return url;
        }
        return URI.create(fhirBaseUrl + "/").resolve(url).toString();
    }

    private static List<String> readStringList(JsonNode node, String field) {
        JsonNode array = node.path(field);
        if (!array.isArray()) {
            return List.of();
        }
        return objectMapper.convertValue(array, new TypeReference<List<String>>() {});
    }

    private record CacheEntry(SmartConfiguration config, Instant fetchedAt) {}

    public record SmartConfiguration(
        String authorizationEndpoint,
        String tokenEndpoint,
        List<String> capabilities,
        List<String> grantTypes,
        List<String> codeChallengeMethods,
        List<String> tokenEndpointAuthMethods,
        List<String> tokenEndpointAuthSigningAlgs,
        String issuer,
        String jwksUri
    ) {
        /** True when the server advertises the capabilities the SPA user login flow needs. */
        public boolean supportsUserLogin() {
            return authorizationEndpoint != null
                && codeChallengeMethods.contains("S256")
                && grantTypes.contains("authorization_code");
        }
    }
}
