package org.hl7.davinci.security;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Performs UDAP Dynamic Client Registration with UDAP-enabled authorization servers.
 * At startup, registers with the configured FAST Security RI (primary issuer).
 * Also supports on-demand discovery and registration with custom FHIR servers,
 * caching registrations per-issuer so that multiple resource servers sharing
 * the same authorization server reuse one registration.
 */
@Component
public class UdapClientRegistration {

    private static final Logger logger = LoggerFactory.getLogger(UdapClientRegistration.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final SecurityProperties securityProperties;
    private final CertificateHolder certificateHolder;
    private final OutboundTargetValidator outboundTargetValidator;

    /** Per-issuer registration cache. Keyed by normalized issuer URL. */
    private final ConcurrentHashMap<String, ServerRegistration> issuerRegistrations = new ConcurrentHashMap<>();

    /** Maps resource server URLs to their discovered issuer URLs. */
    private final ConcurrentHashMap<String, String> serverToIssuerMap = new ConcurrentHashMap<>();

    private volatile String clientId;
    private volatile String authorizeEndpoint;
    private volatile String tokenEndpoint;
    private volatile String redirectUri;
    private volatile boolean registered = false;

    /** Result of a UDAP Dynamic Client Registration with any server. */
    public record ServerRegistration(
        String clientId,
        String authorizeEndpoint,
        String tokenEndpoint,
        String redirectUri,
        String issuer,
        String userinfoEndpoint
    ) {}

    /** Result of probing a FHIR server for UDAP support with optional automatic DCR. */
    public record DiscoveryResult(
        boolean udapEnabled,
        String issuer,
        String authorizationEndpoint,
        boolean registered,
        boolean tieredOauthSupported
    ) {}

    public UdapClientRegistration(
            SecurityProperties securityProperties,
            CertificateHolder certificateHolder,
            OutboundTargetValidator outboundTargetValidator) {
        this.securityProperties = securityProperties;
        this.certificateHolder = certificateHolder;
        this.outboundTargetValidator = outboundTargetValidator;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        if (!securityProperties.isEnableAuthentication() || !certificateHolder.isInitialized()) {
            logger.info("UDAP client registration skipped (auth disabled or cert not initialized)");
            return;
        }
        try {
            register();
        } catch (Exception e) {
            logger.warn("UDAP client registration failed at startup (will retry on /auth/login): {}", e.getMessage());
        }
    }

    /**
     * Discover FAST RI endpoints and register as a UDAP client.
     * Safe to call multiple times; skips if already registered.
     */
    public synchronized void register() throws Exception {
        if (registered) return;

        String issuer = securityProperties.getIssuer().replaceAll("/+$", "");
        String udapUrl = issuer + "/.well-known/udap";

        ServerRegistration result = performRegistration(udapUrl);
        this.clientId = result.clientId();
        this.authorizeEndpoint = result.authorizeEndpoint();
        this.tokenEndpoint = result.tokenEndpoint();
        this.redirectUri = result.redirectUri();
        this.registered = true;

        issuerRegistrations.put(UrlMatchUtil.normalizeUrl(issuer), result);
        logger.info("UDAP client registered successfully with client_id: {}", clientId);
    }

    /**
     * Ensures registration is complete before proceeding.
     * Called lazily from SpaAuthController if startup registration failed.
     */
    public void ensureRegistered() throws Exception {
        if (!registered) {
            register();
        }
    }

    /**
     * Probes a FHIR server for UDAP support and performs DCR if the server's
     * issuer has not been registered with yet. Results are cached per-issuer,
     * so multiple resource servers sharing the same authorization server reuse
     * one registration. This method is idempotent.
     */
    public DiscoveryResult discoverAndRegister(String fhirServerUrl) {
        String normalizedUrl = UrlMatchUtil.normalizeUrl(fhirServerUrl);
        String udapUrl = normalizedUrl + "/.well-known/udap";

        try {
            outboundTargetValidator.validate(normalizedUrl);
            outboundTargetValidator.validate(udapUrl);

            HttpClient client = SecurityUtil.getHttpClient(securityProperties);
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(udapUrl))
                .GET()
                .timeout(Duration.ofSeconds(10))
                .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                return new DiscoveryResult(false, null, null, false, false);
            }

            Map<String, Object> metadata = objectMapper.readValue(
                response.body(), new TypeReference<>() {});

            String authorizeEp = (String) metadata.get("authorization_endpoint");
            String tokenEp = (String) metadata.get("token_endpoint");
            String registrationEndpoint = (String) metadata.get("registration_endpoint");
            String userinfoEp = (String) metadata.get("userinfo_endpoint");

            if (authorizeEp == null || tokenEp == null || registrationEndpoint == null) {
                return new DiscoveryResult(false, null, null, false, false);
            }

            outboundTargetValidator.validate(authorizeEp);
            outboundTargetValidator.validate(tokenEp);
            outboundTargetValidator.validate(registrationEndpoint);
            if (userinfoEp != null) {
                outboundTargetValidator.validate(userinfoEp);
            }

            String issuer = (String) metadata.get("issuer");
            if (issuer == null) {
                URI authUri = URI.create(authorizeEp);
                issuer = authUri.getScheme() + "://" + authUri.getAuthority();
                logger.warn("UDAP metadata missing issuer, derived from authorization_endpoint: {}", issuer);
            }
            String normalizedIssuer = UrlMatchUtil.normalizeUrl(issuer);

            // Detect Tiered OAuth support from UDAP metadata
            boolean tieredOauthSupported = false;
            Object profiles = metadata.get("udap_profiles_supported");
            if (profiles instanceof List<?> profileList) {
                tieredOauthSupported = profileList.contains("udap_to");
            }
            if (!tieredOauthSupported) {
                Object scopes = metadata.get("scopes_supported");
                if (scopes instanceof List<?> scopeList) {
                    tieredOauthSupported = scopeList.contains("udap");
                }
            }

            boolean alreadyRegistered = issuerRegistrations.containsKey(normalizedIssuer);
            if (!alreadyRegistered) {
                try {
                    ServerRegistration reg = performRegistration(udapUrl);
                    issuerRegistrations.put(normalizedIssuer, reg);
                    alreadyRegistered = true;
                    logger.info("DCR completed for issuer {} via server {}", normalizedIssuer, normalizedUrl);
                } catch (Exception e) {
                    logger.warn("DCR failed for issuer {}: {}", normalizedIssuer, e.getMessage());
                }
            } else {
                logger.info("Reusing existing registration for issuer {}", normalizedIssuer);
            }

            serverToIssuerMap.put(normalizedUrl, normalizedIssuer);
            return new DiscoveryResult(true, normalizedIssuer, authorizeEp, alreadyRegistered, tieredOauthSupported);

        } catch (Exception e) {
            logger.debug("UDAP discovery failed for {}: {}", fhirServerUrl, e.getMessage());
            return new DiscoveryResult(false, null, null, false, false);
        }
    }

    /**
     * Returns the cached registration for a FHIR server, looking up via the
     * server-to-issuer mapping. Returns null if the server has not been discovered.
     */
    public ServerRegistration getRegistrationForServer(String fhirServerUrl) {
        String normalizedUrl = UrlMatchUtil.normalizeUrl(fhirServerUrl);
        String issuer = serverToIssuerMap.get(normalizedUrl);
        if (issuer == null) return null;
        return issuerRegistrations.get(issuer);
    }

    /**
     * Core registration logic shared between primary (startup) and per-server (on-demand)
     * registration flows. Discovers UDAP metadata, builds a signed software statement,
     * and performs DCR against the target authorization server.
     */
    private ServerRegistration performRegistration(String udapDiscoveryUrl) throws Exception {
        outboundTargetValidator.validate(udapDiscoveryUrl);
        HttpClient client = SecurityUtil.getHttpClient(securityProperties);

        // Discover endpoints from the target server's UDAP metadata
        logger.info("Discovering UDAP endpoints from: {}", udapDiscoveryUrl);
        HttpRequest discoveryRequest = HttpRequest.newBuilder()
            .uri(URI.create(udapDiscoveryUrl))
            .GET()
            .build();

        HttpResponse<String> discoveryResponse = client.send(discoveryRequest, HttpResponse.BodyHandlers.ofString());
        if (discoveryResponse.statusCode() != 200) {
            throw new RuntimeException("UDAP discovery failed: HTTP " + discoveryResponse.statusCode());
        }

        Map<String, Object> udapMetadata = objectMapper.readValue(
            discoveryResponse.body(), new TypeReference<>() {});

        String authorizeEp = (String) udapMetadata.get("authorization_endpoint");
        String tokenEp = (String) udapMetadata.get("token_endpoint");
        String registrationEndpoint = (String) udapMetadata.get("registration_endpoint");
        String userinfoEp = (String) udapMetadata.get("userinfo_endpoint");

        if (registrationEndpoint == null || authorizeEp == null || tokenEp == null) {
            throw new RuntimeException("UDAP metadata missing required endpoints");
        }

        outboundTargetValidator.validate(authorizeEp);
        outboundTargetValidator.validate(tokenEp);
        outboundTargetValidator.validate(registrationEndpoint);
        if (userinfoEp != null) {
            outboundTargetValidator.validate(userinfoEp);
        }

        // Extract issuer from metadata, falling back to authorization_endpoint origin
        String issuerStr = (String) udapMetadata.get("issuer");
        if (issuerStr == null) {
            URI authUri = URI.create(authorizeEp);
            issuerStr = authUri.getScheme() + "://" + authUri.getAuthority();
            logger.warn("UDAP metadata missing issuer, derived from authorization_endpoint: {}", issuerStr);
        }

        logger.info("Discovered endpoints - authorize: {}, token: {}, registration: {}",
            authorizeEp, tokenEp, registrationEndpoint);

        // Build software statement for DCR
        // FAST RI normalizes issuer URLs with a trailing slash
        String baseUrl = securityProperties.getServerBaseUrl();
        if (!baseUrl.endsWith("/")) {
            baseUrl += "/";
        }

        // Redirect to the SPA's callback route (uses externalBaseUrl in dev mode)
        String externalBaseUrl = securityProperties.getExternalBaseUrl();
        String callbackBase = (externalBaseUrl != null && !externalBaseUrl.isBlank())
            ? externalBaseUrl.replaceAll("/+$", "") + "/"
            : baseUrl;
        String regRedirectUri = callbackBase + "callback";

        JWTClaimsSet softwareStatementClaims = new JWTClaimsSet.Builder()
            .issuer(baseUrl)
            .subject(baseUrl)
            .audience(registrationEndpoint)
            .expirationTime(Date.from(Instant.now().plusSeconds(300)))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .claim("client_name", securityProperties.getClientName())
            .claim("grant_types", List.of("authorization_code"))
            .claim("response_types", List.of("code"))
            .claim("redirect_uris", List.of(regRedirectUri))
            .claim("contacts", List.of("mailto:admin@localhost"))
            .claim("logo_uri", "https://build.fhir.org/icon-fhir-16.png")
            .claim("token_endpoint_auth_method", List.of("private_key_jwt"))
            .claim("scope", buildRegistrationScope())
            .build();

        // UDAP IG requires only alg and x5c in the header (no kid)
        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(certificateHolder.getX509CertChain())
            .build();

        SignedJWT signedStatement = new SignedJWT(header, softwareStatementClaims);
        signedStatement.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        // POST registration request (certifications required by UDAP IG, even if empty)
        Map<String, Object> registrationBody = Map.of(
            "software_statement", signedStatement.serialize(),
            "certifications", List.of(),
            "udap", "1"
        );

        HttpRequest regRequest = HttpRequest.newBuilder()
            .uri(URI.create(registrationEndpoint))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(registrationBody)))
            .build();

        HttpResponse<String> regResponse = client.send(regRequest, HttpResponse.BodyHandlers.ofString());
        if (regResponse.statusCode() != 200 && regResponse.statusCode() != 201) {
            throw new RuntimeException("UDAP registration failed: HTTP " + regResponse.statusCode()
                + " " + regResponse.body());
        }

        Map<String, Object> regResult = objectMapper.readValue(
            regResponse.body(), new TypeReference<>() {});
        String regClientId = (String) regResult.get("client_id");

        logger.info("UDAP client registered with client_id: {} via {}", regClientId, udapDiscoveryUrl);
        return new ServerRegistration(regClientId, authorizeEp, tokenEp, regRedirectUri, issuerStr, userinfoEp);
    }

    /**
     * Builds the scope string used in the DCR software statement. Includes the
     * configured identity scopes plus the role-based resource scopes the SPA
     * may request after login. The authorization server uses this list to
     * decide which scopes the client is allowed to request at /authorize time;
     * scopes omitted here will be rejected as out-of-bounds even if the SPA
     * later asks for them.
     */
    private String buildRegistrationScope() {
        java.util.LinkedHashSet<String> scopes = new java.util.LinkedHashSet<>();
        for (String s : securityProperties.getScope().split("\\s+")) {
            if (!s.isBlank()) {
                scopes.add(s);
            }
        }
        scopes.addAll(securityProperties.getPractitionerScopes());
        scopes.addAll(securityProperties.getPatientScopes());
        return String.join(" ", scopes);
    }

    public String getClientId() { return clientId; }
    public String getAuthorizeEndpoint() { return authorizeEndpoint; }
    public String getTokenEndpoint() { return tokenEndpoint; }
    public String getRedirectUri() { return redirectUri; }
    public boolean isRegistered() { return registered; }
}
