package org.hl7.davinci.security;

import com.nimbusds.jose.jwk.RSAKey;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CertificateHolderTest {

    private static final String TEST_CERT_PATH = "src/test/resources/test-cert.pfx";
    private static final String TEST_CERT_PASSWORD = "testpass";

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
    void noCertFile_noFetch_throws() {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(false);
        props.setCertFile(null);

        assertThrows(IllegalArgumentException.class,
            () -> new CertificateHolder(props));
    }

    @Test
    void certFileWithoutPassword_throws() {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(null);

        assertThrows(IllegalArgumentException.class,
            () -> new CertificateHolder(props));
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
}
