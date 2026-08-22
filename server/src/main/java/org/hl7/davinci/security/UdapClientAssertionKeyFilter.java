package org.hl7.davinci.security;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Date;
import java.util.List;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.util.Base64;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Learns a recovered tiered client's signing key from its own client_assertion,
 * since a restart-recovered {@link TieredClientRecovery} client has no key yet
 * and the RI's discovery metadata does not carry one either. Runs ahead of the
 * Spring Security chain on /oauth2/token so the key is in {@link UdapClientKeyStore}
 * before private_key_jwt authentication fetches it via jwkSetUrl.
 *
 * TODO: validate trust chain against community trust anchors. Same
 * self-consistency bar as UdapRegistrationController's DCR path: any x5c that
 * verifies its own JWT is accepted.
 */
@Component
public class UdapClientAssertionKeyFilter extends OncePerRequestFilter {

    private static final Logger logger = LoggerFactory.getLogger(UdapClientAssertionKeyFilter.class);

    private final UdapClientKeyStore clientKeyStore;

    public UdapClientAssertionKeyFilter(UdapClientKeyStore clientKeyStore) {
        this.clientKeyStore = clientKeyStore;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String assertion = "POST".equalsIgnoreCase(request.getMethod())
            ? request.getParameter("client_assertion") : null;
        if (assertion != null) {
            learnKey(assertion);
        }
        filterChain.doFilter(request, response);
    }

    private void learnKey(String assertion) {
        try {
            SignedJWT signedJwt = SignedJWT.parse(assertion);
            String clientId = signedJwt.getJWTClaimsSet().getSubject();
            if (clientId == null
                    || TieredClientIds.decode(clientId).isEmpty()
                    || clientKeyStore.get(clientId) != null) {
                return;
            }

            List<Base64> x5c = signedJwt.getHeader().getX509CertChain();
            if (x5c == null || x5c.isEmpty()) {
                logger.warn("client_assertion for {} has no x5c header", clientId);
                return;
            }

            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            X509Certificate leafCert = (X509Certificate) cf.generateCertificate(
                new ByteArrayInputStream(x5c.get(0).decode()));
            RSAKey rsaKey = RSAKey.parse(leafCert);
            if (!signedJwt.verify(new RSASSAVerifier(rsaKey))) {
                logger.warn("client_assertion for {} does not verify against its own x5c leaf", clientId);
                return;
            }

            JWTClaimsSet claims = signedJwt.getJWTClaimsSet();
            if (!clientId.equals(claims.getIssuer())) {
                logger.warn("client_assertion for {} has iss/sub mismatch", clientId);
                return;
            }
            Date expTime = claims.getExpirationTime();
            if (expTime == null || expTime.before(new Date())) {
                logger.warn("client_assertion for {} is expired or missing exp", clientId);
                return;
            }

            RSAKey clientJwk = new RSAKey.Builder(rsaKey.toRSAPublicKey())
                .keyUse(KeyUse.SIGNATURE)
                .algorithm(JWSAlgorithm.RS256)
                .build();
            clientKeyStore.put(clientId, clientJwk);
            logger.info("Learned assertion key for tiered client {}", clientId);
        } catch (Exception e) {
            logger.warn("Failed to learn key from client_assertion: {}", e.getMessage());
        }
    }
}
