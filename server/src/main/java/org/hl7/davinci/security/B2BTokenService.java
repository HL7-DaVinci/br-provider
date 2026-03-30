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
            OutboundTargetValidator outboundTargetValidator) {
        this.certificateHolder = certificateHolder;
        this.securityProperties = securityProperties;
        this.outboundTargetValidator = outboundTargetValidator;
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
        if (!certificateHolder.isInitialized()) {
            logger.warn("Certificate not initialized, cannot obtain B2B token");
            return null;
        }

        String scopeString = String.join(" ", scopes);
        String cacheKey = targetBaseUrl + "|" + scopeString;

        CachedToken cached = tokenCache.get(cacheKey);
        if (cached != null && !cached.isExpired()) {
            return cached.accessToken();
        }

        try {
            String token = requestToken(targetBaseUrl, scopeString);
            return token;
        } catch (Exception e) {
            logger.error("Failed to obtain B2B token for {}: {}", targetBaseUrl, e.getMessage());
            return null;
        }
    }

    private String requestToken(String targetBaseUrl, String scopeString) throws Exception {
        String normalizedTarget = UrlMatchUtil.normalizeUrl(targetBaseUrl);

        // 1. Discover UDAP metadata and perform DCR if needed
        B2BRegistration registration = ensureRegistered(normalizedTarget);

        // 2. Build the client assertion JWT with hl7-b2b extension
        String clientAssertion = buildClientAssertionJwt(
            registration.clientId(), registration.tokenEndpoint());

        // 3. POST to the token endpoint
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

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
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

        String cacheKey = targetBaseUrl + "|" + scopeString;
        tokenCache.put(cacheKey, new CachedToken(accessToken, Instant.now().plusSeconds(expiresIn)));
        logger.debug("B2B token cached for {} (expires in {}s)", targetBaseUrl, expiresIn);

        return accessToken;
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

        // Discover UDAP metadata
        String udapUrl = targetBaseUrl + "/.well-known/udap";
        outboundTargetValidator.validate(udapUrl);

        HttpClient client = SecurityUtil.getHttpClient(securityProperties);
        HttpRequest discoveryRequest = HttpRequest.newBuilder()
            .uri(URI.create(udapUrl))
            .GET()
            .timeout(Duration.ofSeconds(10))
            .build();

        HttpResponse<String> discoveryResponse = client.send(discoveryRequest, HttpResponse.BodyHandlers.ofString());
        if (discoveryResponse.statusCode() != 200) {
            throw new RuntimeException("UDAP discovery failed for " + udapUrl
                + ": HTTP " + discoveryResponse.statusCode());
        }

        Map<String, Object> metadata = objectMapper.readValue(
            discoveryResponse.body(), new TypeReference<>() {});

        String tokenEndpoint = (String) metadata.get("token_endpoint");
        String registrationEndpoint = (String) metadata.get("registration_endpoint");
        if (tokenEndpoint == null) {
            throw new RuntimeException("UDAP metadata missing token_endpoint");
        }

        outboundTargetValidator.validate(tokenEndpoint);

        // Derive issuer for cache key (some servers omit it)
        String issuer = (String) metadata.get("issuer");
        if (issuer == null) {
            URI tokenUri = URI.create(tokenEndpoint);
            issuer = tokenUri.getScheme() + "://" + tokenUri.getAuthority();
        }
        String normalizedIssuer = UrlMatchUtil.normalizeUrl(issuer);

        // Check by issuer in case a previous registration used a different target URL
        existing = b2bRegistrations.get(normalizedIssuer);
        if (existing != null) {
            b2bRegistrations.put(targetBaseUrl, existing);
            return existing;
        }

        // Perform B2B-specific DCR with client_credentials grant
        if (registrationEndpoint == null) {
            throw new RuntimeException("UDAP metadata missing registration_endpoint; cannot perform B2B DCR");
        }
        outboundTargetValidator.validate(registrationEndpoint);

        B2BRegistration registration = performB2BRegistration(registrationEndpoint, tokenEndpoint);
        b2bRegistrations.put(normalizedIssuer, registration);
        b2bRegistrations.put(targetBaseUrl, registration);
        logger.info("B2B DCR completed for issuer {}, client_id: {}", normalizedIssuer, registration.clientId());

        return registration;
    }

    /**
     * Performs UDAP Dynamic Client Registration with client_credentials grant type.
     * Follows the same pattern as {@link UdapClientRegistration#performRegistration}
     * but with B2B-specific grant types and no redirect URIs.
     */
    private B2BRegistration performB2BRegistration(
            String registrationEndpoint, String tokenEndpoint) throws Exception {

        String providerBaseUrl = securityProperties.getProviderBaseUrl();
        if (!providerBaseUrl.endsWith("/")) {
            providerBaseUrl += "/";
        }

        JWTClaimsSet softwareStatementClaims = new JWTClaimsSet.Builder()
            .issuer(providerBaseUrl)
            .subject(providerBaseUrl)
            .audience(registrationEndpoint)
            .expirationTime(Date.from(Instant.now().plusSeconds(300)))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .claim("client_name", securityProperties.getClientName() + " (B2B)")
            .claim("grant_types", List.of("client_credentials"))
            .claim("token_endpoint_auth_method", List.of("private_key_jwt"))
            .claim("contacts", List.of("mailto:admin@localhost"))
            .claim("logo_uri", "https://build.fhir.org/icon-fhir-16.png")
            .claim("scope", "system/*.read system/*.write")
            .build();

        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(certificateHolder.getX509CertChain())
            .build();

        SignedJWT signedStatement = new SignedJWT(header, softwareStatementClaims);
        signedStatement.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        Map<String, Object> registrationBody = Map.of(
            "software_statement", signedStatement.serialize(),
            "certifications", List.of(),
            "udap", "1"
        );

        HttpClient client = SecurityUtil.getHttpClient(securityProperties);
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(registrationEndpoint))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(registrationBody)))
            .timeout(Duration.ofSeconds(15))
            .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200 && response.statusCode() != 201) {
            throw new RuntimeException("B2B DCR failed: HTTP " + response.statusCode()
                + " " + response.body());
        }

        Map<String, Object> result = objectMapper.readValue(
            response.body(), new TypeReference<>() {});
        String clientId = (String) result.get("client_id");
        if (clientId == null) {
            throw new RuntimeException("B2B DCR response missing client_id");
        }

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
            "organization_id", "urn:oid:provider-org",
            "organization_name", "Provider Organization",
            "purpose_of_use", List.of("urn:oid:2.16.840.1.113883.5.8#TREAT")
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
