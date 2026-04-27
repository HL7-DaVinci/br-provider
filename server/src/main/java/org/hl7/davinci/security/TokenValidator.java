package org.hl7.davinci.security;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Date;
import java.util.List;
import javax.net.ssl.SSLContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Validates JWTs from two trusted issuers:
 * 1. The FAST RI authorization server (trust community authority) for user tokens
 * 2. This server's own Spring Authorization Server for B2B client_credentials tokens
 *
 * Tokens are validated against the issuer's published JWKS. The issuer claim
 * determines which key source is used for signature verification.
 */
@Component
public class TokenValidator {

    private static final Logger logger = LoggerFactory.getLogger(TokenValidator.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final SecurityProperties securityProperties;
    private final CertificateHolder certificateHolder;
    private volatile JWKSource<SecurityContext> remoteJwkSource;
    private final Object jwkSourceLock = new Object();

    @Autowired
    public TokenValidator(SecurityProperties securityProperties, CertificateHolder certificateHolder) {
        this.securityProperties = securityProperties;
        this.certificateHolder = certificateHolder;
    }

    // Package-private constructor for testability with injected JWKSource
    TokenValidator(SecurityProperties securityProperties, JWKSource<SecurityContext> jwkSource) {
        this.securityProperties = securityProperties;
        this.certificateHolder = null;
        this.remoteJwkSource = jwkSource;
    }

    public JWTClaimsSet validate(String token) throws Exception {
        if (!securityProperties.isEnableAuthentication()) {
            throw new JOSEException("Authentication is disabled");
        }

        String localIssuer = securityProperties.getServerBaseUrl();
        String remoteIssuer = SecurityUtil.resolveIssuer(securityProperties);

        // Peek at the token's issuer to select the correct key source
        String tokenIssuer = peekIssuer(token);
        JWKSource<SecurityContext> source;

        if (tokenIssuer != null && isLocalIssuer(tokenIssuer, localIssuer)) {
            source = getLocalJwkSource();
            logger.debug("Validating locally-issued token (B2B client_credentials)");
        } else {
            source = getRemoteJwkSource();
        }

        DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        processor.setJWSTypeVerifier((type, context) -> {});
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, source));
        processor.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(null, null));

        JWTClaimsSet claims = processor.process(token, null);

        // Validate issuer is one of the two trusted issuers
        String claimedIssuer = claims.getIssuer();
        boolean isLocal = isLocalIssuer(claimedIssuer, localIssuer);
        boolean isRemote = remoteIssuer != null && remoteIssuer.equals(claimedIssuer);
        if (!isLocal && !isRemote) {
            throw new JOSEException("Untrusted issuer: " + claimedIssuer);
        }

        if (claims.getExpirationTime() == null || claims.getExpirationTime().before(new Date())) {
            throw new JOSEException("Token expired");
        }

        if (!isRemote) {
            validateAudience(claims);
        }

        return claims;
    }

    void validateAudience(JWTClaimsSet claims) throws JOSEException {
        List<String> audiences = claims.getAudience();
        if (audiences == null || audiences.stream().noneMatch(this::isAudienceAllowed)) {
            throw new JOSEException("Token audience does not match this FHIR server");
        }
    }

    /**
     * An audience matches the configured smart FHIR base URL exactly, or
     * matches by scheme/port/path with a host listed in allowedLocalHosts
     * so a token issued for http://localhost:8080/fhir is also valid when
     * the request comes in on http://host.docker.internal:8080/fhir.
     */
    boolean isAudienceAllowed(String audience) {
        String normalizedAudience = normalizeUrl(audience);
        String normalizedBase = normalizeUrl(securityProperties.getSmartFhirBaseUrl());
        if (normalizedAudience.equals(normalizedBase)) {
            return true;
        }
        try {
            URI audUri = new URI(normalizedAudience);
            URI baseUri = new URI(normalizedBase);
            if (audUri.getPort() != baseUri.getPort()
                    || !nullSafe(audUri.getScheme()).equalsIgnoreCase(nullSafe(baseUri.getScheme()))
                    || !nullSafe(audUri.getPath()).equals(nullSafe(baseUri.getPath()))) {
                return false;
            }
            String audHost = audUri.getHost();
            if (audHost == null) {
                return false;
            }
            return securityProperties.getAllowedLocalHosts().stream()
                .anyMatch(allowed -> allowed.equalsIgnoreCase(audHost));
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private static String normalizeUrl(String value) {
        return value == null ? "" : value.replaceAll("/+$", "");
    }

    private static String nullSafe(String value) {
        return value == null ? "" : value;
    }

    /**
     * Extracts the issuer from the JWT payload without full validation,
     * used to route to the correct key source.
     */
    private String peekIssuer(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length >= 2) {
                String payload = new String(java.util.Base64.getUrlDecoder().decode(parts[1]));
                return objectMapper.readTree(payload).path("iss").asText(null);
            }
        } catch (Exception e) {
            logger.debug("Failed to peek at token issuer", e);
        }
        return null;
    }

    /**
     * Checks if the token issuer matches this server. Spring Authorization Server
     * uses the request URL as the issuer, so we normalize for comparison.
     */
    private boolean isLocalIssuer(String tokenIssuer, String localBase) {
        if (tokenIssuer == null || localBase == null) return false;
        String normalized = tokenIssuer.replaceAll("/+$", "");
        return normalized.equals(localBase.replaceAll("/+$", ""));
    }

    private JWKSource<SecurityContext> getLocalJwkSource() throws JOSEException {
        if (certificateHolder == null || !certificateHolder.isInitialized()) {
            throw new JOSEException("Local signing keys not available");
        }
        return new ImmutableJWKSet<>(certificateHolder.getJwkSet());
    }

    private JWKSource<SecurityContext> getRemoteJwkSource() throws Exception {
        JWKSource<SecurityContext> source = this.remoteJwkSource;
        if (source != null) {
            return source;
        }
        synchronized (jwkSourceLock) {
            source = this.remoteJwkSource;
            if (source != null) {
                return source;
            }
            source = discoverJwkSource();
            this.remoteJwkSource = source;
            return source;
        }
    }

    private JWKSource<SecurityContext> discoverJwkSource() throws Exception {
        String issuer = SecurityUtil.resolveIssuer(securityProperties);
        String discoveryUrl = issuer + "/.well-known/openid-configuration";

        logger.info("Discovering JWKS from: {}", discoveryUrl);

        HttpClient httpClient = SecurityUtil.getHttpClient(securityProperties);
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(discoveryUrl))
            .GET()
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new JOSEException("OIDC discovery failed: HTTP " + response.statusCode());
        }

        JsonNode config = objectMapper.readTree(response.body());
        String jwksUri = config.get("jwks_uri").asText();
        logger.info("JWKS URI: {}", jwksUri);

        SSLContext sslContext = SecurityUtil.getTrustAllSslContext(securityProperties);
        javax.net.ssl.SSLSocketFactory sslFactory = sslContext != null ? sslContext.getSocketFactory() : null;
        DefaultResourceRetriever retriever = new DefaultResourceRetriever(5000, 5000, 0, true, sslFactory);

        return JWKSourceBuilder.create(new URL(jwksUri), retriever).build();
    }
}
