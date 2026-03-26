package org.hl7.davinci.security;

import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Signs JWTs for the CDS Hooks {@code Authorization: Bearer} header per the
 * CDS Hooks spec "Trusting CDS Clients" section. This is a client identity
 * assertion, not a token exchange -- distinct from B2B access tokens.
 *
 * @see <a href="https://cds-hooks.org/specification/current/#trusting-cds-clients">CDS Hooks - Trusting CDS Clients</a>
 */
@Service
public class CdsClientJwtService {

    private static final Logger logger = LoggerFactory.getLogger(CdsClientJwtService.class);

    private final CertificateHolder certificateHolder;
    private final SecurityProperties securityProperties;

    public CdsClientJwtService(
            CertificateHolder certificateHolder,
            SecurityProperties securityProperties) {
        this.certificateHolder = certificateHolder;
        this.securityProperties = securityProperties;
    }

    /**
     * Creates a signed JWT for authenticating with a CDS service endpoint.
     * Returns null if the certificate is not initialized (auth disabled mode).
     *
     * @param cdsServiceUrl the specific CDS service endpoint URL being called (used as {@code aud})
     * @return signed JWT string, or null if signing is unavailable
     */
    public String createClientJwt(String cdsServiceUrl) {
        if (!certificateHolder.isInitialized()) {
            logger.warn("Certificate not initialized, cannot create CDS client JWT");
            return null;
        }

        try {
            String providerBaseUrl = securityProperties.getProviderBaseUrl();

            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(providerBaseUrl)
                .audience(cdsServiceUrl)
                .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                .issueTime(new Date())
                .jwtID(UUID.randomUUID().toString())
                .build();

            // RS384 is RECOMMENDED by the CDS Hooks spec for client JWTs
            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS384)
                .keyID(certificateHolder.getSigningKey().getKeyID())
                .type(JOSEObjectType.JWT)
                .build();

            SignedJWT jwt = new SignedJWT(header, claims);
            jwt.sign(new RSASSASigner(certificateHolder.getSigningKey()));

            return jwt.serialize();
        } catch (Exception e) {
            logger.error("Failed to create CDS client JWT for {}: {}", cdsServiceUrl, e.getMessage());
            return null;
        }
    }

}
