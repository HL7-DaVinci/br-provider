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

    private final KeyStore keyStore;
    private final RSAKey signingKey;
    private final X509Certificate certificate;
    private final List<com.nimbusds.jose.util.Base64> x509CertChain;

    public CertificateHolder(
            SecurityProperties securityProperties
    ) throws Exception {

        if (!securityProperties.isEnableAuthentication()) {
            if (securityProperties.getCertFile() == null) {
                logger.info("Authentication disabled; skipping certificate initialization");
                this.keyStore = null;
                this.signingKey = null;
                this.certificate = null;
                this.x509CertChain = null;
                return;
            }

            logger.info("Authentication disabled; loading explicitly configured certificate");
        }

        this.keyStore = initializeCert(securityProperties, securityProperties.getServerBaseUrl());

        String alias = keyStore.aliases().nextElement();
        this.certificate = (X509Certificate) keyStore.getCertificate(alias);

        RSAPublicKey publicKey = (RSAPublicKey) certificate.getPublicKey();
        RSAPrivateKey privateKey = (RSAPrivateKey) keyStore.getKey(alias,
            securityProperties.getCertPassword().toCharArray());

        java.security.cert.Certificate[] chain = keyStore.getCertificateChain(alias);
        this.x509CertChain = new ArrayList<>();
        if (chain != null) {
            for (java.security.cert.Certificate cert : chain) {
                x509CertChain.add(com.nimbusds.jose.util.Base64.encode(cert.getEncoded()));
            }
        } else {
            x509CertChain.add(com.nimbusds.jose.util.Base64.encode(certificate.getEncoded()));
        }

        this.signingKey = new RSAKey.Builder(publicKey)
            .privateKey(privateKey)
            .keyUse(KeyUse.SIGNATURE)
            .algorithm(JWSAlgorithm.RS256)
            .keyID("provider-signing-key")
            .x509CertChain(x509CertChain)
            .build();

        logger.info("Certificate loaded successfully. Subject: {}", certificate.getSubjectX500Principal());
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
