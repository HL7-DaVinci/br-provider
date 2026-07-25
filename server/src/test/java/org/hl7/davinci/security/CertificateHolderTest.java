package org.hl7.davinci.security;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import com.nimbusds.jose.jwk.RSAKey;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CertificateHolderTest {

    private static final String TEST_CERT_PATH = "src/test/resources/test-cert.pfx";
    private static final String TEST_CERT_PASSWORD = "testpass";

    @BeforeEach
    void deleteStaleGeneratedCert() throws Exception {
        Path certPath = Paths.get("generated-cert.pfx");
        Files.deleteIfExists(certPath);
    }

    @Test
    void explicitCertPath_loadsSuccessfully() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        props.setEnableAuthentication(true);

        CertificateHolder holder = new CertificateHolder(props);

        assertTrue(holder.isInitialized());
        assertNotNull(holder.getSigningKey());
        assertNotNull(holder.getCertificate());
        assertNotNull(holder.getX509CertChain());
        assertFalse(holder.getX509CertChain().isEmpty());
        assertNotNull(holder.getJwkSet());
    }

    @Test
    void authDisabled_withoutExplicitCert_skipsInitializationEvenWhenFetchEnabled() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(false);
        props.setCertFile(null);

        CertificateHolder holder = new CertificateHolder(props);

        assertFalse(holder.isInitialized());
        assertNull(holder.getSigningKey());
    }

    @Test
    void authDisabled_withExplicitCert_loadsConfiguredCertificate() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(false);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);

        CertificateHolder holder = new CertificateHolder(props);

        assertTrue(holder.isInitialized());
        assertNotNull(holder.getSigningKey());
        assertNotNull(holder.getCertificate());
    }

    @Test
    void noCertFile_noFetch_staysUninitialized() {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(false);
        props.setCertFile(null);

        CertificateHolder holder = assertDoesNotThrow(() -> new CertificateHolder(props));

        assertFalse(holder.isInitialized());
    }

    @Test
    void certFileWithoutPassword_staysUninitialized() {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(null);

        CertificateHolder holder = assertDoesNotThrow(() -> new CertificateHolder(props));

        assertFalse(holder.isInitialized());
    }

    @Test
    void stripsServerFhirSuffix() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        props.setEnableAuthentication(true);

        CertificateHolder holder = new CertificateHolder(props);

        assertTrue(holder.isInitialized());
        assertEquals("provider-signing-key", holder.getSigningKey().getKeyID());
    }

    @Test
    void jwkSetIncludesPrivateKeyForTokenSigning() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        props.setEnableAuthentication(true);

        CertificateHolder holder = new CertificateHolder(props);
        RSAKey jwk = (RSAKey) holder.getJwkSet().getKeys().get(0);

        assertNotNull(jwk.toPrivateKey());
    }

    @Test
    void startupSurvivesUnreachableIssuer() {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(true);
        props.setIssuer("https://localhost:1");
        props.setFetchCertRetryAttempts(1);
        props.setFetchCertRetryDelay(0);

        CertificateHolder holder = assertDoesNotThrow(() -> new CertificateHolder(props));

        assertFalse(holder.isInitialized());
    }

    @Test
    void ensureInitializedSkipsWhenAuthDisabledAndNoCert() {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(false);
        props.setCertFile(null);
        props.setFetchCert(true);

        CertificateHolder holder = new CertificateHolder(props);

        long start = System.currentTimeMillis();
        boolean result = holder.ensureInitialized();
        long elapsedMs = System.currentTimeMillis() - start;

        assertFalse(result);
        assertFalse(holder.isInitialized());
        assertTrue(elapsedMs < 2000, "ensureInitialized() should return instantly, took " + elapsedMs + "ms");
    }

    @Test
    void ensureInitializedHonorsCooldown() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(true);
        props.setIssuer("https://localhost:1");
        props.setFetchCertRetryAttempts(1);
        props.setFetchCertRetryDelay(0);

        CertificateHolder holder = assertDoesNotThrow(() -> new CertificateHolder(props));
        assertFalse(holder.isInitialized());

        long firstAttemptMs = holder.lastInitAttemptMs();
        // Ensure a measurable gap so a retry (if the cooldown check were removed)
        // would record a strictly later timestamp than firstAttemptMs.
        Thread.sleep(5);

        long start = System.currentTimeMillis();
        boolean result = holder.ensureInitialized();
        long elapsedMs = System.currentTimeMillis() - start;

        assertFalse(result);
        assertTrue(elapsedMs < 2000, "ensureInitialized() should skip retry during cooldown, took " + elapsedMs + "ms");
        // The real discriminator: within the cooldown window, ensureInitialized() must not
        // have re-attempted initialize(), so lastInitAttemptMs is untouched. If the cooldown
        // check were deleted, this call would retry and overwrite it with a later timestamp,
        // failing this assertion.
        assertEquals(firstAttemptMs, holder.lastInitAttemptMs(),
            "ensureInitialized() must not update lastInitAttemptMs during the cooldown window");
    }
}
