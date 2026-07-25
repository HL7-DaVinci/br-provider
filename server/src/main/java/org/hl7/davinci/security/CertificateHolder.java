package org.hl7.davinci.security;

import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.ResourceUtils;

@Component
public class CertificateHolder {

    private static final Logger logger = LoggerFactory.getLogger(CertificateHolder.class);

    /** Minimum time between on-demand initialization retries, to avoid hammering an unreachable issuer. */
    private static final long INIT_RETRY_COOLDOWN_MS = 60_000;

    private final SecurityProperties securityProperties;

    private RSAKey signingKey;
    private X509Certificate certificate;
    private List<com.nimbusds.jose.util.Base64> x509CertChain;
    // keyStore is written last in initialize() so that a reader observing keyStore != null
    // (isInitialized()) is guaranteed, via the volatile write's happens-before edge, to also
    // see the fully-published signingKey/certificate/x509CertChain from the same initialization.
    private volatile KeyStore keyStore;

    private volatile long lastInitAttemptMs;

    public CertificateHolder(
            SecurityProperties securityProperties
    ) {
        this.securityProperties = securityProperties;

        if (nothingToInitialize()) {
            logger.info("Authentication disabled; skipping certificate initialization");
            return;
        }

        lastInitAttemptMs = System.currentTimeMillis();
        try {
            initialize();
        } catch (Exception e) {
            logger.error("Certificate initialization failed; starting without a certificate. "
                + "UDAP registration and B2B tokens are unavailable until a retry succeeds.", e);
        }
    }

    /**
     * Attempts certificate initialization if not already initialized, subject to a
     * cooldown between retries. Returns true if a certificate is available afterward.
     */
    public synchronized boolean ensureInitialized() {
        if (isInitialized()) {
            return true;
        }
        if (nothingToInitialize()) {
            return false;
        }
        long now = System.currentTimeMillis();
        if (now - lastInitAttemptMs < INIT_RETRY_COOLDOWN_MS) {
            return false;
        }
        lastInitAttemptMs = now;
        try {
            initialize();
            return true;
        } catch (Exception e) {
            logger.warn("Certificate initialization retry failed: {}", e.getMessage());
            return false;
        }
    }

    private boolean nothingToInitialize() {
        return !securityProperties.isEnableAuthentication() && securityProperties.getCertFile() == null;
    }

    private void initialize() throws Exception {
        if (!securityProperties.isEnableAuthentication()) {
            logger.info("Authentication disabled; loading explicitly configured certificate");
        }

        KeyStore loadedKeyStore = initializeCert(securityProperties, securityProperties.getServerBaseUrl());

        String alias = loadedKeyStore.aliases().nextElement();
        X509Certificate loadedCertificate = (X509Certificate) loadedKeyStore.getCertificate(alias);

        RSAPublicKey publicKey = (RSAPublicKey) loadedCertificate.getPublicKey();
        RSAPrivateKey privateKey = (RSAPrivateKey) loadedKeyStore.getKey(alias,
            securityProperties.getCertPassword().toCharArray());

        java.security.cert.Certificate[] chain = loadedKeyStore.getCertificateChain(alias);
        List<com.nimbusds.jose.util.Base64> loadedX509CertChain = new ArrayList<>();
        if (chain != null) {
            for (java.security.cert.Certificate cert : chain) {
                loadedX509CertChain.add(com.nimbusds.jose.util.Base64.encode(cert.getEncoded()));
            }
        } else {
            loadedX509CertChain.add(com.nimbusds.jose.util.Base64.encode(loadedCertificate.getEncoded()));
        }

        RSAKey loadedSigningKey = new RSAKey.Builder(publicKey)
            .privateKey(privateKey)
            .keyUse(KeyUse.SIGNATURE)
            .algorithm(JWSAlgorithm.RS256)
            .keyID("provider-signing-key")
            .x509CertChain(loadedX509CertChain)
            .build();

        this.certificate = loadedCertificate;
        this.x509CertChain = loadedX509CertChain;
        this.signingKey = loadedSigningKey;
        this.keyStore = loadedKeyStore;

        logger.info("Certificate loaded successfully. Subject: {}", loadedCertificate.getSubjectX500Principal());
    }

    // --- Three-path cert initialization ---

    private KeyStore initializeCert(SecurityProperties props, String serverAddress) throws Exception {
        if (props.getCertFile() != null) {
            if (props.getCertPassword() == null) {
                throw new IllegalArgumentException("Cert password is required when a cert file is configured.");
            }
            return loadKeyStore(props.getCertFile(), props.getCertPassword());
        }

        if (props.isFetchCert()) {
            props.setCertFile("generated-cert.pfx");
            props.setCertPassword(props.getDefaultCertPassword());

            Path certPath = Paths.get("generated-cert.pfx");
            if (Files.exists(certPath)) {
                logger.info("Certificate already exists at: {}", certPath.toAbsolutePath());
                return loadKeyStore(certPath.toString(), props.getCertPassword());
            }

            if (props.getIssuer() == null) {
                throw new IllegalArgumentException(
                    "Issuer is not configured. Set security.issuer to the UDAP security server URL.");
            }

            fetchCertFromIssuer(props, serverAddress, certPath);
            return loadKeyStore(certPath.toString(), props.getCertPassword());
        }

        throw new IllegalArgumentException(
            "No cert file configured. Either set security.cert-file or security.fetch-cert=true.");
    }

    private void fetchCertFromIssuer(SecurityProperties props, String serverAddress, Path certPath)
            throws Exception {
        String certUrl = props.getIssuer().replaceAll("/+$", "") + "/api/cert/generate";
        HttpClient client = SecurityUtil.getHttpClient(props);

        String jsonBody = String.format(
            "{\"altNames\":[\"%s\"],\"password\":\"%s\"}",
            serverAddress, props.getDefaultCertPassword()
        );

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(certUrl))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
            .build();

        logger.info("Fetching certificate from: {}", certUrl);

        IOException lastException = null;
        for (int attempt = 1; attempt <= props.getFetchCertRetryAttempts(); attempt++) {
            try {
                logger.info("Certificate fetch attempt {} of {}", attempt, props.getFetchCertRetryAttempts());
                HttpResponse<Path> response = client.send(request, HttpResponse.BodyHandlers.ofFile(certPath));
                if (response.statusCode() == 200) {
                    logger.info("Certificate saved to: {}", certPath.toAbsolutePath());
                    return;
                }
                throw new IOException("HTTP " + response.statusCode());
            } catch (IOException | InterruptedException e) {
                lastException = (e instanceof IOException) ? (IOException) e : new IOException("Interrupted", e);
                logger.warn("Certificate fetch attempt {} failed: {}", attempt, e.getMessage());
                if (attempt < props.getFetchCertRetryAttempts()) {
                    Thread.sleep(props.getFetchCertRetryDelay());
                }
            }
        }
        throw new IOException("Failed to fetch certificate after " +
            props.getFetchCertRetryAttempts() + " attempts", lastException);
    }

    private KeyStore loadKeyStore(String certFileOrBase64, String password) throws Exception {
        InputStream stream = null;
        try {
            byte[] bytes = Base64.getDecoder().decode(certFileOrBase64);
            stream = new ByteArrayInputStream(bytes);
        } catch (IllegalArgumentException e) {
            // Not base64, treat as file path
        }

        if (stream == null) {
            stream = new FileInputStream(ResourceUtils.getFile(certFileOrBase64));
        }

        KeyStore ks = KeyStore.getInstance("PKCS12");
        ks.load(stream, password.toCharArray());
        stream.close();
        return ks;
    }

    /** Visible for testing: exposes the timestamp of the last initialization attempt. */
    long lastInitAttemptMs() { return lastInitAttemptMs; }

    public boolean isInitialized() { return keyStore != null; }
    public KeyStore getKeyStore() { return keyStore; }
    public RSAKey getSigningKey() { return signingKey; }
    public X509Certificate getCertificate() { return certificate; }
    public List<com.nimbusds.jose.util.Base64> getX509CertChain() { return x509CertChain; }
    public JWKSet getJwkSet() {
        // Spring Authorization Server needs the private key available for Jwt encoding.
        // Its JWK set endpoint serializes only the public portion when responding.
        return new JWKSet(signingKey);
    }
}
