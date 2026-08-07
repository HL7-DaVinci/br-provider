package org.hl7.davinci.security;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Authorization code flow mechanics for the SPA: the in-flight flow store,
 * PKCE material, the per-auth-method token request, and the token endpoint
 * call itself. Holds no session state, which belongs to
 * {@link SessionTokenService}.
 */
@Component
public class AuthCodeFlowService {

    private static final Logger logger = LoggerFactory.getLogger(AuthCodeFlowService.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final SecureRandom secureRandom = new SecureRandom();
    private static final long PENDING_FLOW_TTL_SECONDS = 300;

    private final UdapClientRegistration udapClient;
    private final SessionTokenService sessionTokens;
    private final SecurityProperties securityProperties;
    private final SmartClientDiscoveryService smartDiscovery;
    private final SmartClientKeyService smartClientKeyService;
    private final ConcurrentHashMap<String, PendingFlow> pendingFlows = new ConcurrentHashMap<>();

    public AuthCodeFlowService(
            UdapClientRegistration udapClient,
            SessionTokenService sessionTokens,
            SecurityProperties securityProperties,
            SmartClientDiscoveryService smartDiscovery,
            SmartClientKeyService smartClientKeyService) {
        this.udapClient = udapClient;
        this.sessionTokens = sessionTokens;
        this.securityProperties = securityProperties;
        this.smartDiscovery = smartDiscovery;
        this.smartClientKeyService = smartClientKeyService;
    }

    /**
     * Tracks an in-progress OAuth authorization code flow.
     * For primary login, serverUrl/tokenEndpoint/clientId are null (use udapClient).
     * For custom server auth, they contain the custom server's registration details.
     * authMethod is one of "udap", "smart-none", "smart-basic",
     * "smart-private-key-jwt", or "smart-ehr-launch". clientSecret and launch
     * are only populated for the SMART flows that need them.
     */
    public record PendingFlow(String codeVerifier, String redirectUri, Instant createdAt,
                       String serverUrl, String tokenEndpoint, String clientId,
                       String authMethod, String clientSecret, String launch,
                       String requestedScope) {
        public PendingFlow(String codeVerifier, String redirectUri, Instant createdAt) {
            this(codeVerifier, redirectUri, createdAt, null, null, null, "udap", null, null, null);
        }

        public PendingFlow(String codeVerifier, String redirectUri, Instant createdAt,
                    String serverUrl, String tokenEndpoint, String clientId, String requestedScope) {
            this(codeVerifier, redirectUri, createdAt, serverUrl, tokenEndpoint, clientId,
                "udap", null, null, requestedScope);
        }

        String resolvedAuthMethod() {
            return authMethod != null ? authMethod : "udap";
        }
    }

    /** Signals a token endpoint response the flow cannot continue from. */
    static class TokenExchangeException extends Exception {
        TokenExchangeException(String message) {
            super(message);
        }
    }

    void put(String state, PendingFlow flow) {
        pendingFlows.put(state, flow);
    }

    /**
     * Claims the flow for a state parameter. A flow is single-use, so a
     * replayed code cannot be exchanged twice.
     */
    PendingFlow claim(String state) {
        pruneExpiredFlows();
        return pendingFlows.remove(state);
    }

    private void pruneExpiredFlows() {
        Instant cutoff = Instant.now().minusSeconds(PENDING_FLOW_TTL_SECONDS);
        pendingFlows.entrySet().removeIf(entry -> entry.getValue().createdAt().isBefore(cutoff));
    }

    // Visible for testing
    ConcurrentHashMap<String, PendingFlow> getPendingFlows() {
        return pendingFlows;
    }

    static String generateCodeVerifier() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String generateCodeChallenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes("US-ASCII"));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }

    /**
     * Exchanges the authorization code at the token endpoint and returns the
     * parsed token response.
     */
    Map<String, Object> requestTokens(PendingFlow flow, String code, String tokenEndpoint)
            throws Exception {
        TokenRequestSpec spec = buildTokenRequest(flow, code);

        HttpClient httpClient = SecurityUtil.getHttpClient(securityProperties);
        HttpRequest.Builder builder = HttpRequest.newBuilder()
            .uri(URI.create(tokenEndpoint))
            .header("Content-Type", "application/x-www-form-urlencoded");
        if (spec.basicAuthHeader() != null) {
            builder.header("Authorization", spec.basicAuthHeader());
        }
        HttpRequest tokenRequest = builder
            .POST(HttpRequest.BodyPublishers.ofString(SessionTokenService.formEncode(spec.params())))
            .build();

        HttpResponse<String> tokenResponse = httpClient.send(tokenRequest, HttpResponse.BodyHandlers.ofString());
        if (tokenResponse.statusCode() != 200) {
            logger.error("Token exchange failed: HTTP {} {}", tokenResponse.statusCode(), tokenResponse.body());
            throw new TokenExchangeException("Token endpoint returned HTTP " + tokenResponse.statusCode());
        }
        return objectMapper.readValue(tokenResponse.body(), new TypeReference<>() {});
    }

    /**
     * Pairs the token exchange form parameters with the Basic auth header
     * a smart-basic exchange needs, since that credential rides the
     * Authorization header rather than the form body.
     */
    record TokenRequestSpec(Map<String, String> params, String basicAuthHeader) {}

    /**
     * Each method sends only what it requires. udap signs a private_key_jwt
     * assertion and adds udap=1. A public client sends client_id and the PKCE
     * verifier. smart-basic drops client_id from the form and carries the
     * credentials in the Basic header. smart-private-key-jwt signs a fresh
     * assertion with the SMART client key.
     */
    TokenRequestSpec buildTokenRequest(PendingFlow flow, String code) throws Exception {
        return switch (flow.resolvedAuthMethod()) {
            case "smart-none", "smart-ehr-launch" -> buildSmartPublicTokenRequest(flow, code);
            case "smart-basic" -> buildSmartBasicTokenRequest(flow, code);
            case "smart-private-key-jwt" -> buildSmartPrivateKeyJwtTokenRequest(flow, code);
            default -> buildUdapTokenRequest(flow, code);
        };
    }

    private TokenRequestSpec buildUdapTokenRequest(PendingFlow flow, String code) throws Exception {
        String tokenEndpoint = flow.tokenEndpoint() != null
            ? flow.tokenEndpoint() : udapClient.getTokenEndpoint();
        String clientId = flow.clientId() != null
            ? flow.clientId() : udapClient.getClientId();

        String clientAssertion = buildClientAssertionFor(tokenEndpoint, clientId);
        Map<String, String> params = baseTokenParams(flow, code);
        params.put("client_id", clientId);
        params.put("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
        params.put("client_assertion", clientAssertion);
        params.put("udap", "1");
        return new TokenRequestSpec(params, null);
    }

    private TokenRequestSpec buildSmartPublicTokenRequest(PendingFlow flow, String code) {
        Map<String, String> params = baseTokenParams(flow, code);
        params.put("client_id", flow.clientId());
        return new TokenRequestSpec(params, null);
    }

    private TokenRequestSpec buildSmartBasicTokenRequest(PendingFlow flow, String code) {
        String basicAuthHeader = "Basic " + Base64.getEncoder().encodeToString(
            (flow.clientId() + ":" + flow.clientSecret()).getBytes(StandardCharsets.UTF_8));
        return new TokenRequestSpec(baseTokenParams(flow, code), basicAuthHeader);
    }

    private TokenRequestSpec buildSmartPrivateKeyJwtTokenRequest(PendingFlow flow, String code) throws Exception {
        Map<String, String> params = baseTokenParams(flow, code);
        params.put("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
        params.put("client_assertion", smartClientKeyService.buildClientAssertion(
            flow.clientId(), flow.tokenEndpoint(), chooseAlg(flow)));
        return new TokenRequestSpec(params, null);
    }

    private static Map<String, String> baseTokenParams(PendingFlow flow, String code) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("grant_type", "authorization_code");
        params.put("code", code);
        params.put("redirect_uri", flow.redirectUri());
        params.put("code_verifier", flow.codeVerifier());
        return params;
    }

    /**
     * Picks RS384 unless the server's discovered signing algorithms advertise
     * ES384 only. Falls back to RS384 on any discovery error.
     */
    JWSAlgorithm chooseAlg(PendingFlow flow) {
        try {
            SmartClientDiscoveryService.SmartConfiguration config = smartDiscovery.discover(flow.serverUrl());
            return SmartClientKeyService.selectAssertionAlgorithm(config.tokenEndpointAuthSigningAlgs());
        } catch (Exception e) {
            logger.warn("SMART discovery failed while choosing client assertion algorithm for {}: {}",
                flow.serverUrl(), e.getMessage());
            return JWSAlgorithm.RS384;
        }
    }

    /**
     * Builds a signed client assertion JWT for the specified token endpoint and client.
     */
    String buildClientAssertionFor(String tokenEndpoint, String clientId) throws Exception {
        return sessionTokens.buildUdapClientAssertion(tokenEndpoint, clientId);
    }

    static Map<String, Object> buildSmartContext(Map<String, Object> tokens) {
        Map<String, Object> smartContext = new LinkedHashMap<>();
        if (tokens.get("patient") instanceof String patient && !patient.isBlank()) {
            smartContext.put("patient", patient);
        }
        if (tokens.get("encounter") instanceof String encounter && !encounter.isBlank()) {
            smartContext.put("encounter", encounter);
        }
        List<String> fhirContext = parseFhirContext(tokens.get("fhirContext"));
        if (!fhirContext.isEmpty()) {
            smartContext.put("fhirContext", fhirContext);
        }
        if (tokens.get("appContext") instanceof String appContext && !appContext.isBlank()) {
            smartContext.put("appContext", appContext);
        }
        return smartContext;
    }

    /**
     * Normalizes a SMART fhirContext value to reference strings. Accepts the
     * legacy string-array shape and the current object-array shape, where
     * each object yields its reference, else canonical, else identifier
     * (rendered as system|value, or the identifier's toString otherwise).
     */
    static List<String> parseFhirContext(Object raw) {
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<String> result = new ArrayList<>();
        for (Object item : list) {
            String value = parseFhirContextEntry(item);
            if (value != null && !value.isBlank()) {
                result.add(value);
            }
        }
        return result;
    }

    private static String parseFhirContextEntry(Object item) {
        if (item instanceof String s) {
            return s;
        }
        if (!(item instanceof Map<?, ?> map)) {
            return null;
        }
        if (map.get("reference") instanceof String reference && !reference.isBlank()) {
            return reference;
        }
        if (map.get("canonical") instanceof String canonical && !canonical.isBlank()) {
            return canonical;
        }
        Object identifier = map.get("identifier");
        return identifier != null ? renderIdentifier(identifier) : null;
    }

    private static String renderIdentifier(Object identifier) {
        if (identifier instanceof Map<?, ?> idMap && idMap.containsKey("system") && idMap.containsKey("value")) {
            return idMap.get("system") + "|" + idMap.get("value");
        }
        return identifier.toString();
    }
}
