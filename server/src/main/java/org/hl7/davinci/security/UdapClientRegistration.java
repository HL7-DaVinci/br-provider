package org.hl7.davinci.security;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Performs UDAP Dynamic Client Registration with the FAST Security RI at startup.
 * Discovers endpoints from the provider's own UDAP metadata (which points to the FAST RI),
 * builds and signs a software statement, and stores the returned client_id.
 */
@Component
public class UdapClientRegistration {

    private static final Logger logger = LoggerFactory.getLogger(UdapClientRegistration.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final SecurityProperties securityProperties;
    private final CertificateHolder certificateHolder;

    private volatile String clientId;
    private volatile String authorizeEndpoint;
    private volatile String tokenEndpoint;
    private volatile String redirectUri;
    private volatile boolean registered = false;

    public UdapClientRegistration(
            SecurityProperties securityProperties,
            CertificateHolder certificateHolder) {
        this.securityProperties = securityProperties;
        this.certificateHolder = certificateHolder;
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
        HttpClient client = SecurityUtil.getHttpClient(securityProperties);

        // Discover endpoints from FAST RI's UDAP metadata
        String udapUrl = issuer + "/.well-known/udap";
        logger.info("Discovering UDAP endpoints from: {}", udapUrl);

        HttpRequest discoveryRequest = HttpRequest.newBuilder()
            .uri(URI.create(udapUrl))
            .GET()
            .build();

        HttpResponse<String> discoveryResponse = client.send(discoveryRequest, HttpResponse.BodyHandlers.ofString());
        if (discoveryResponse.statusCode() != 200) {
            throw new RuntimeException("UDAP discovery failed: HTTP " + discoveryResponse.statusCode());
        }

        Map<String, Object> udapMetadata = objectMapper.readValue(
            discoveryResponse.body(), new TypeReference<>() {});

        this.authorizeEndpoint = (String) udapMetadata.get("authorization_endpoint");
        this.tokenEndpoint = (String) udapMetadata.get("token_endpoint");
        String registrationEndpoint = (String) udapMetadata.get("registration_endpoint");

        if (registrationEndpoint == null || authorizeEndpoint == null || tokenEndpoint == null) {
            throw new RuntimeException("UDAP metadata missing required endpoints");
        }

        logger.info("Discovered endpoints - authorize: {}, token: {}, registration: {}",
            authorizeEndpoint, tokenEndpoint, registrationEndpoint);

        // Build and sign software statement
        // FAST RI normalizes issuer URLs with a trailing slash
        String baseUrl = securityProperties.getServerBaseUrl();
        if (!baseUrl.endsWith("/")) {
            baseUrl += "/";
        }

        // Redirect to the SPA's callback route (uses externalBaseUrl in dev mode)
        String callbackBase = securityProperties.getExternalBaseUrl() != null
            ? securityProperties.getExternalBaseUrl().replaceAll("/+$", "") + "/"
            : baseUrl;
        this.redirectUri = callbackBase + "callback";

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
            .claim("redirect_uris", List.of(redirectUri))
            .claim("contacts", List.of("mailto:admin@localhost"))
            .claim("logo_uri", "https://build.fhir.org/icon-fhir-16.png")
            .claim("token_endpoint_auth_method", List.of("private_key_jwt"))
            .claim("scope", securityProperties.getScope())
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
        this.clientId = (String) regResult.get("client_id");
        this.registered = true;

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

    public String getClientId() { return clientId; }
    public String getAuthorizeEndpoint() { return authorizeEndpoint; }
    public String getTokenEndpoint() { return tokenEndpoint; }
    public String getRedirectUri() { return redirectUri; }
    public boolean isRegistered() { return registered; }
}
