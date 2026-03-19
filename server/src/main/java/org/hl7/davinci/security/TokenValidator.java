package org.hl7.davinci.security;

import java.net.URI;
import java.net.URL;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Date;
import javax.net.ssl.SSLContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
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
 * Validates FAST RI-issued JWTs using remote JWKS discovery.
 * Tokens are issued by the FAST RI authorization server (the trust community authority)
 * and validated against its published public keys.
 */
@Component
public class TokenValidator {

    private static final Logger logger = LoggerFactory.getLogger(TokenValidator.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final SecurityProperties securityProperties;
    private volatile JWKSource<SecurityContext> jwkSource;
    private final Object jwkSourceLock = new Object();

    @Autowired
    public TokenValidator(SecurityProperties securityProperties) {
        this.securityProperties = securityProperties;
    }

    // Package-private constructor for testability with injected JWKSource
    TokenValidator(SecurityProperties securityProperties, JWKSource<SecurityContext> jwkSource) {
        this.securityProperties = securityProperties;
        this.jwkSource = jwkSource;
    }

    public JWTClaimsSet validate(String token) throws Exception {
        if (!securityProperties.isEnableAuthentication()) {
            throw new JOSEException("Authentication is disabled");
        }

        JWKSource<SecurityContext> source = getJwkSource();

        DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        // UDAP IG does not constrain access token type or format
        processor.setJWSTypeVerifier((type, context) -> {});
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, source));

        // Require expiration claim, no audience validation per UDAP IG
        processor.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(null, null));

        JWTClaimsSet claims = processor.process(token, null);

        // Validate issuer against the FAST RI
        String expectedIssuer = SecurityUtil.resolveIssuer(securityProperties);
        if (expectedIssuer != null && !expectedIssuer.equals(claims.getIssuer())) {
            throw new JOSEException("Invalid issuer: expected " + expectedIssuer
                + " got " + claims.getIssuer());
        }

        if (claims.getExpirationTime() == null || claims.getExpirationTime().before(new Date())) {
            throw new JOSEException("Token expired");
        }

        return claims;
    }

    private JWKSource<SecurityContext> getJwkSource() throws Exception {
        JWKSource<SecurityContext> source = this.jwkSource;
        if (source != null) {
            return source;
        }
        synchronized (jwkSourceLock) {
            source = this.jwkSource;
            if (source != null) {
                return source;
            }
            source = discoverJwkSource();
            this.jwkSource = source;
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
