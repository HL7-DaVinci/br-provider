package org.hl7.davinci.security;

import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Mints short-lived locally-signed access tokens for server-internal callers
 * (DtrPopulateController, PasProxyController, etc.) that need to invoke this
 * server's own FHIR endpoints over HTTP without piggybacking on a user session.
 *
 * Tokens are signed by {@link CertificateHolder}'s key, which is the same key
 * advertised in this server's JWKS, so {@link TokenValidator} accepts them
 * via its locally-issued path. The issuer claim is the server's own base URL,
 * so the audience-mismatch check in {@link SmartScopeAuthorizationService} is
 * exercised normally (not bypassed via the trusted-issuer shortcut).
 *
 * No DCR, no HTTP roundtrip, no shared secret. The trust boundary is "code
 * running in this JVM holds the signing key" -- which is the same boundary
 * that signs every other token this server emits.
 */
@Component
public class LocalSystemTokenService {

    private static final Logger logger = LoggerFactory.getLogger(LocalSystemTokenService.class);
    private static final String SYSTEM_SUBJECT = "internal:provider-system";
    private static final Duration DEFAULT_TTL = Duration.ofMinutes(5);

    private final CertificateHolder certificateHolder;
    private final SecurityProperties securityProperties;

    public LocalSystemTokenService(
            CertificateHolder certificateHolder,
            SecurityProperties securityProperties) {
        this.certificateHolder = certificateHolder;
        this.securityProperties = securityProperties;
    }

    /**
     * Mints a fresh access token carrying the requested scopes. Returns null
     * (with a logged error) if the signing key is not available -- callers
     * should treat that as a hard failure.
     */
    public String mintSystemToken(List<String> scopes) {
        if (!certificateHolder.isInitialized()) {
            logger.error("Cannot mint local system token: signing key not initialized");
            return null;
        }
        if (scopes == null || scopes.isEmpty()) {
            throw new IllegalArgumentException("scopes must not be empty");
        }
        try {
            Instant now = Instant.now();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(securityProperties.getServerBaseUrl())
                .subject(SYSTEM_SUBJECT)
                .audience(List.of(securityProperties.getSmartFhirBaseUrl()))
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(DEFAULT_TTL)))
                .jwtID(UUID.randomUUID().toString())
                .claim("scope", String.join(" ", scopes))
                .build();

            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID(certificateHolder.getSigningKey().getKeyID())
                .build();
            SignedJWT signed = new SignedJWT(header, claims);
            signed.sign(new RSASSASigner(certificateHolder.getSigningKey()));
            return signed.serialize();
        } catch (Exception e) {
            logger.error("Failed to mint local system token: {}", e.getMessage(), e);
            return null;
        }
    }
}
