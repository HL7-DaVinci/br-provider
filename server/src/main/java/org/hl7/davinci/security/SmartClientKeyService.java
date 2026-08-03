package org.hl7.davinci.security;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Holds the RSA and EC key pairs SMART clients use to sign
 * private_key_jwt client assertions, and builds those assertions.
 */
@Component
public class SmartClientKeyService {

    private static final Logger logger = LoggerFactory.getLogger(SmartClientKeyService.class);

    private static final String RSA_KEY_ID = "smart-client-rs";
    private static final String EC_KEY_ID = "smart-client-es";
    private static final long ASSERTION_TTL_SECONDS = 300;

    private RSAKey rsaKey;
    private ECKey ecKey;

    /**
     * Where to keep the key pair across restarts. Empty generates fresh keys
     * on every start, which invalidates any registration that embedded them.
     */
    @Value("${security.smart-client-key-file:}")
    private String keyFile;

    @PostConstruct
    public void init() throws Exception {
        Path path = (keyFile == null || keyFile.isBlank()) ? null : Path.of(keyFile);
        if (path != null && Files.exists(path) && load(path)) {
            logger.info("Loaded SMART client keys from {}", path);
            return;
        }

        // Declare the signing algorithm on each key. Servers that verify the
        // client assertion select the algorithm from the published JWK.
        rsaKey = new RSAKeyGenerator(2048)
            .keyID(RSA_KEY_ID)
            .keyUse(KeyUse.SIGNATURE)
            .algorithm(JWSAlgorithm.RS384)
            .generate();
        ecKey = new ECKeyGenerator(Curve.P_384)
            .keyID(EC_KEY_ID)
            .keyUse(KeyUse.SIGNATURE)
            .algorithm(JWSAlgorithm.ES384)
            .generate();

        if (path != null && save(path)) {
            logger.info("Saved SMART client keys to {}", path);
        }
    }

    private boolean load(Path path) {
        try {
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                logger.warn("Ignoring SMART client key file {}: not a regular file", path);
                return false;
            }
            JWKSet saved = JWKSet.load(path.toFile());
            RSAKey rsa = (RSAKey) saved.getKeyByKeyId(RSA_KEY_ID);
            ECKey ec = (ECKey) saved.getKeyByKeyId(EC_KEY_ID);
            if (rsa == null || ec == null || !rsa.isPrivate() || !ec.isPrivate()) {
                return false;
            }
            rsaKey = rsa;
            ecKey = ec;
            return true;
        } catch (Exception e) {
            logger.warn("Could not read SMART client keys from {}: {}", path, e.getMessage());
            return false;
        }
    }

    /**
     * The file holds private keys. It is created with owner-only permissions
     * before any key material is written, then moved into place. A file system
     * without POSIX permissions gets no key file, so the keys stay in memory.
     */
    private boolean save(Path path) throws IOException {
        Path dir = path.getParent();
        if (dir == null) {
            logger.warn("SMART client key file {} has no parent directory", path);
            return false;
        }
        if (!FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            logger.warn("This file system cannot restrict permissions, so {} was not written. "
                + "SMART client keys change on every restart.", path);
            return false;
        }

        Files.createDirectories(dir, PosixFilePermissions.asFileAttribute(
            PosixFilePermissions.fromString("rwx------")));
        Path temp = Files.createTempFile(dir, ".smart-client-keys", ".tmp",
            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        Files.writeString(temp, new JWKSet(List.of(rsaKey, ecKey)).toString(false));
        Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        return true;
    }

    public RSAKey getRsaKey() { return rsaKey; }
    public ECKey getEcKey() { return ecKey; }

    public JWKSet publicJwkSet() {
        return new JWKSet(List.of(rsaKey.toPublicJWK(), ecKey.toPublicJWK()));
    }

    public String buildClientAssertion(String clientId, String tokenEndpoint, JWSAlgorithm alg) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .issuer(clientId)
            .subject(clientId)
            .audience(tokenEndpoint)
            .expirationTime(Date.from(Instant.now().plusSeconds(ASSERTION_TTL_SECONDS)))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .build();

        JWSSigner signer;
        String kid;
        if (JWSAlgorithm.RS384.equals(alg)) {
            signer = new RSASSASigner(rsaKey);
            kid = RSA_KEY_ID;
        } else if (JWSAlgorithm.ES384.equals(alg)) {
            signer = new ECDSASigner(ecKey);
            kid = EC_KEY_ID;
        } else {
            throw new IllegalArgumentException("Unsupported SMART client assertion algorithm: " + alg);
        }

        JWSHeader header = new JWSHeader.Builder(alg)
            .keyID(kid)
            .type(com.nimbusds.jose.JOSEObjectType.JWT)
            .build();

        SignedJWT signedJwt = new SignedJWT(header, claims);
        signedJwt.sign(signer);
        return signedJwt.serialize();
    }
}
