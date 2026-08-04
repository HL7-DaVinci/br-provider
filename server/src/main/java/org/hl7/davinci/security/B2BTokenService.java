package org.hl7.davinci.security;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Obtains B2B access tokens from payer servers using the UDAP client_credentials grant.
 * Used by DTR and PAS proxy controllers to authenticate outbound requests.
 *
 * Flow per target server:
 * 1. Discover UDAP metadata from the target's /.well-known/udap endpoint
 * 2. Perform DCR with grant_types=["client_credentials"] if not yet registered
 * 3. Build a client assertion JWT containing the hl7-b2b extension
 * 4. Exchange the assertion for an access token at the target's token endpoint
 * 5. Cache the token until shortly before expiry
 */
@Service
public class B2BTokenService {

    private static final Logger logger = LoggerFactory.getLogger(B2BTokenService.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final CertificateHolder certificateHolder;
    private final SecurityProperties securityProperties;
    private final OutboundTargetValidator outboundTargetValidator;
    private final ServerProperties serverProperties;
    private final SmartClientKeyService smartClientKeyService;
    private final SmartClientDiscoveryService smartClientDiscoveryService;
    private final UdapDcrClient dcrClient;

    /** Cached access tokens keyed by "targetBaseUrl|scopes". */
    private final ConcurrentHashMap<String, CachedToken> tokenCache = new ConcurrentHashMap<>();

    /** B2B DCR registrations keyed by normalized issuer URL. */
    private final ConcurrentHashMap<String, B2BRegistration> b2bRegistrations = new ConcurrentHashMap<>();

    private record CachedToken(String accessToken, Instant expiresAt) {
        boolean isExpired() {
            return Instant.now().isAfter(expiresAt.minusSeconds(30));
        }
    }

    private record B2BRegistration(String clientId, String tokenEndpoint) {}

    public B2BTokenService(
            CertificateHolder certificateHolder,
            SecurityProperties securityProperties,
            OutboundTargetValidator outboundTargetValidator,
            ServerProperties serverProperties,
            SmartClientKeyService smartClientKeyService,
            SmartClientDiscoveryService smartClientDiscoveryService) {
        this.certificateHolder = certificateHolder;
        this.securityProperties = securityProperties;
        this.outboundTargetValidator = outboundTargetValidator;
        this.serverProperties = serverProperties;
        this.smartClientKeyService = smartClientKeyService;
        this.smartClientDiscoveryService = smartClientDiscoveryService;
        this.dcrClient = new UdapDcrClient(securityProperties, certificateHolder, outboundTargetValidator);
    }

    /**
     * Get a B2B access token for the target server. Returns null if auth is
     * disabled or the certificate is not available.
     *
     * @param targetBaseUrl base URL of the payer FHIR server (used for UDAP discovery)
     * @param scopes        OAuth scopes to request (e.g. system/*.read)
     * @return bearer access token, or null if unavailable
     */
    public String getTokenForServer(String targetBaseUrl, List<String> scopes) {
        return getTokenForServer(targetBaseUrl, scopes, null);
    }

    /**
     * Variant that honors the caller's requested auth flow over the target's
     * configured auth-type. "smart-backend" forces SMART Backend Services and
     * fails when no client-id is configured for the target, since that flow
     * cannot register dynamically. "b2b" forces UDAP client credentials.
     * Null routes by configuration.
     */
    public String getTokenForServer(String targetBaseUrl, List<String> scopes, String requestedAuth) {
        return getTokenForServer(targetBaseUrl, scopes, requestedAuth, null);
    }

    /**
     * Variant that takes a client id for a target absent from app.payer-servers,
     * so a payer configured in the settings dialog can use SMART Backend
     * Services. A configured client-id wins over this one.
     */
    public String getTokenForServer(String targetBaseUrl, List<String> scopes, String requestedAuth,
            String sessionClientId) {
        String scopeString = String.join(" ", scopes);

        ServerProperties.B2bAuthConfig authConfig = serverProperties.findB2bAuthConfig(targetBaseUrl);
        if ((authConfig == null || authConfig.clientId() == null)
                && sessionClientId != null && !sessionClientId.isBlank()) {
            String authType = authConfig != null ? authConfig.authType() : "smart-backend";
            String tokenUrl = authConfig != null ? authConfig.tokenUrl() : null;
            authConfig = new ServerProperties.B2bAuthConfig(authType, tokenUrl, sessionClientId);
        }

        // The cache is process-wide, so the client id keeps one session's token
        // from being handed to a session that named a different client.
        String clientKey = authConfig != null && authConfig.clientId() != null ? authConfig.clientId() : "";
        String cacheKey = targetBaseUrl + "|" + scopeString + "|" + clientKey;

        CachedToken cached = tokenCache.get(cacheKey);
        if (cached != null && !cached.isExpired()) {
            return cached.accessToken();
        }

        if ("smart-backend".equals(requestedAuth)) {
            if (authConfig == null || authConfig.clientId() == null) {
                logger.warn("SMART Backend Services requested for {} but no client-id is available; "
                    + "set one in the settings dialog or in app.payer-servers", targetBaseUrl);
                return null;
            }
            try {
                return requestBackendServicesToken(targetBaseUrl, authConfig, scopeString, cacheKey);
            } catch (Exception e) {
                logger.error("Failed to obtain SMART Backend Services token for {}: {}",
                    targetBaseUrl, e.getMessage());
                return null;
            }
        }

        boolean forceUdap = "b2b".equals(requestedAuth);
        if (!forceUdap && authConfig != null && "none".equals(authConfig.authType())) {
            return null;
        }

        if (!forceUdap && authConfig != null && "smart-backend".equals(authConfig.authType())) {
            try {
                return requestBackendServicesToken(targetBaseUrl, authConfig, scopeString, cacheKey);
            } catch (Exception e) {
                logger.error("Failed to obtain SMART Backend Services token for {}: {}",
                    targetBaseUrl, e.getMessage());
                return null;
            }
        }

        if (!certificateHolder.ensureInitialized()) {
            logger.warn("Certificate not initialized, cannot obtain B2B token");
            return null;
        }

        try {
            return requestToken(targetBaseUrl, scopeString, cacheKey);
        } catch (Exception e) {
            logger.error("Failed to obtain B2B token for {}: {}", targetBaseUrl, e.getMessage());
            return null;
        }
    }

    private String requestToken(String targetBaseUrl, String scopeString, String cacheKey) throws Exception {
        String normalizedTarget = UrlMatchUtil.normalizeUrl(targetBaseUrl);

        // 1. Discover UDAP metadata and perform DCR if needed
        B2BRegistration registration = ensureRegistered(normalizedTarget);

        // 2. Exchange the client assertion for an access token
        HttpResponse<String> response = sendTokenRequest(registration, scopeString);

        // A 400/401 typically means the authorization server no longer knows
        // this client. Drop the cached registration, re-register, and retry once.
        if (response.statusCode() == 400 || response.statusCode() == 401) {
            logger.warn("B2B token request rejected (HTTP {}) for {}; re-registering",
                response.statusCode(), targetBaseUrl);
            b2bRegistrations.values().removeIf(registration::equals);
            registration = ensureRegistered(normalizedTarget);
            response = sendTokenRequest(registration, scopeString);
        }

        return parseAndCacheToken(response, targetBaseUrl, cacheKey);
    }

    /**
     * Caches the token with its expiry, minus the early-expiry buffer that
     * {@link CachedToken#isExpired()} applies. Shared by the UDAP and SMART
     * Backend Services flows.
     */
    private String parseAndCacheToken(
            HttpResponse<String> response, String targetBaseUrl, String cacheKey) throws Exception {
        if (response.statusCode() != 200) {
            throw new RuntimeException("Token request failed: HTTP " + response.statusCode()
                + " " + response.body());
        }

        Map<String, Object> tokenResponse = objectMapper.readValue(
            response.body(), new TypeReference<>() {});

        String accessToken = (String) tokenResponse.get("access_token");
        if (accessToken == null) {
            throw new RuntimeException("Token response missing access_token");
        }

        // Cache with TTL from response, defaulting to 5 minutes
        long expiresIn = 300;
        Object expiresInObj = tokenResponse.get("expires_in");
        if (expiresInObj instanceof Number num) {
            expiresIn = num.longValue();
        }

        tokenCache.put(cacheKey, new CachedToken(accessToken, Instant.now().plusSeconds(expiresIn)));
        logger.debug("B2B token cached for {} (expires in {}s)", targetBaseUrl, expiresIn);

        return accessToken;
    }

    /**
     * Requests a token via the SMART Backend Services flow: a private_key_jwt
     * client assertion exchanged for a client_credentials grant. Unlike UDAP,
     * this never performs DCR. The client id is pre-registered with the target.
     */
    private String requestBackendServicesToken(
            String targetBaseUrl, ServerProperties.B2bAuthConfig authConfig,
            String scopeString, String cacheKey) throws Exception {
        String clientId = authConfig.clientId();
        if (clientId == null) {
            logger.warn("SMART Backend Services auth configured for {} without a clientId; skipping",
                targetBaseUrl);
            return null;
        }

        String tokenEndpoint = authConfig.tokenUrl();
        List<String> signingAlgs = List.of();
        if (tokenEndpoint == null || tokenEndpoint.isBlank()) {
            SmartClientDiscoveryService.SmartConfiguration config = smartClientDiscoveryService.discover(targetBaseUrl);
            tokenEndpoint = config.tokenEndpoint();
            signingAlgs = config.tokenEndpointAuthSigningAlgs();
        } else {
            try {
                signingAlgs = smartClientDiscoveryService.discover(targetBaseUrl).tokenEndpointAuthSigningAlgs();
            } catch (Exception e) {
                logger.warn("SMART configuration discovery failed for {}, defaulting to RS384: {}",
                    targetBaseUrl, e.getMessage());
            }
        }

        outboundTargetValidator.validate(tokenEndpoint);
        JWSAlgorithm alg = SmartClientKeyService.selectAssertionAlgorithm(signingAlgs);

        HttpRequest request = buildBackendServicesRequest(clientId, tokenEndpoint, scopeString, alg);
        HttpResponse<String> response = SecurityUtil.getHttpClient(securityProperties)
            .send(request, HttpResponse.BodyHandlers.ofString());

        return parseAndCacheToken(response, targetBaseUrl, cacheKey);
    }

    /**
     * Builds the client_credentials token request signed with a private_key_jwt
     * assertion. Confidential asymmetric clients must not send client_id in the form.
     */
    HttpRequest buildBackendServicesRequest(
            String clientId, String tokenEndpoint, String scopeString, JWSAlgorithm alg) throws Exception {
        String clientAssertion = smartClientKeyService.buildClientAssertion(clientId, tokenEndpoint, alg);

        String formBody = "grant_type=" + encode("client_credentials")
            + "&scope=" + encode(scopeString)
            + "&client_assertion_type=" + encode("urn:ietf:params:oauth:client-assertion-type:jwt-bearer")
            + "&client_assertion=" + encode(clientAssertion);

        return HttpRequest.newBuilder()
            .uri(URI.create(tokenEndpoint))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(formBody))
            .timeout(Duration.ofSeconds(15))
            .build();
    }

    /**
     * Builds the client assertion for the registration and POSTs the
     * client_credentials grant to its token endpoint.
     */
    private HttpResponse<String> sendTokenRequest(
            B2BRegistration registration, String scopeString) throws Exception {
        String clientAssertion = buildClientAssertionJwt(
            registration.clientId(), registration.tokenEndpoint());

        String formBody = "grant_type=" + encode("client_credentials")
            + "&client_assertion_type=" + encode("urn:ietf:params:oauth:client-assertion-type:jwt-bearer")
            + "&client_assertion=" + encode(clientAssertion)
            + "&scope=" + encode(scopeString)
            + "&udap=1";

        HttpClient client = SecurityUtil.getHttpClient(securityProperties);
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(registration.tokenEndpoint()))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(formBody))
            .timeout(Duration.ofSeconds(15))
            .build();

        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    /**
     * Ensures a B2B client_credentials DCR has been performed with the target's
     * authorization server. Returns the cached registration if one exists.
     */
    private B2BRegistration ensureRegistered(String targetBaseUrl) throws Exception {
        // Return cached registration without a network call when possible.
        // Registrations are keyed by the normalized target base URL which is
        // known before discovery. The issuer-based key used after DCR is an
        // internal detail stored in the same map via a second put.
        B2BRegistration existing = b2bRegistrations.get(targetBaseUrl);
        if (existing != null) {
            return existing;
        }

        UdapDcrClient.UdapMetadata metadata =
            dcrClient.discoverMetadata(targetBaseUrl + "/.well-known/udap");
        String tokenEndpoint = metadata.tokenEndpoint();
        if (tokenEndpoint == null) {
            throw new RuntimeException("UDAP metadata missing token_endpoint");
        }
        String normalizedIssuer = UrlMatchUtil.normalizeUrl(metadata.issuer());

        // Check by issuer in case a previous registration used a different target URL
        existing = b2bRegistrations.get(normalizedIssuer);
        if (existing != null) {
            b2bRegistrations.put(targetBaseUrl, existing);
            return existing;
        }

        // Perform B2B-specific DCR with client_credentials grant
        if (metadata.registrationEndpoint() == null) {
            throw new RuntimeException("UDAP metadata missing registration_endpoint; cannot perform B2B DCR");
        }

        B2BRegistration registration = performB2BRegistration(metadata.registrationEndpoint(), tokenEndpoint);
        b2bRegistrations.put(normalizedIssuer, registration);
        b2bRegistrations.put(targetBaseUrl, registration);
        logger.info("B2B DCR completed for issuer {}, client_id: {}", normalizedIssuer, registration.clientId());

        return registration;
    }

    /**
     * Performs UDAP Dynamic Client Registration with client_credentials grant
     * type. Shares the discovery and DCR mechanics with
     * {@link UdapClientRegistration} via {@link UdapDcrClient}, with
     * B2B-specific grant types and no redirect URIs.
     */
    private B2BRegistration performB2BRegistration(
            String registrationEndpoint, String tokenEndpoint) throws Exception {

        JWTClaimsSet softwareStatementClaims = dcrClient
            .softwareStatementBase(securityProperties.getProviderBaseUrl(), registrationEndpoint)
            .claim("client_name", securityProperties.getClientName() + " (B2B)")
            .claim("grant_types", List.of("client_credentials"))
            .claim("scope", "system/*.read system/*.write")
            .build();

        String clientId = dcrClient.performDcr(registrationEndpoint, softwareStatementClaims);
        return new B2BRegistration(clientId, tokenEndpoint);
    }

    /**
     * Builds a signed client assertion JWT with the hl7-b2b extension for
     * the client_credentials token request.
     */
    private String buildClientAssertionJwt(
            String clientId, String tokenEndpoint) throws Exception {

        Map<String, Object> b2bExtension = Map.of(
            "version", "1",
            "organization_id", securityProperties.getB2bOrganizationId(),
            "organization_name", securityProperties.getB2bOrganizationName(),
            "purpose_of_use", List.of(securityProperties.getB2bPurposeOfUse())
        );

        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .issuer(clientId)
            .subject(clientId)
            .audience(tokenEndpoint)
            .expirationTime(Date.from(Instant.now().plusSeconds(300)))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .claim("extensions", Map.of("hl7-b2b", b2bExtension))
            .build();

        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(certificateHolder.getX509CertChain())
            .build();

        SignedJWT jwt = new SignedJWT(header, claims);
        jwt.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        return jwt.serialize();
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
