package org.hl7.davinci.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class UdapClientRegistrationTest {

    private static final String TEST_CERT_PATH = "src/test/resources/test-cert.pfx";
    private static final String TEST_CERT_PASSWORD = "testpass";

    SecurityProperties props;

    @BeforeEach
    void setUp() {
        props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setIssuer("https://localhost:5001");
    }

    @Test
    void initialState_notRegistered() throws Exception {
        CertificateHolder cert = testCertificateHolder();

        UdapClientRegistration reg = new UdapClientRegistration(
            props, cert, new OutboundTargetValidator(props));

        assertFalse(reg.isRegistered());
        assertNull(reg.getClientId());
        assertNull(reg.getAuthorizeEndpoint());
        assertNull(reg.getTokenEndpoint());
        assertNull(reg.getRedirectUri());
    }

    @Test
    void startup_skipsWhenAuthDisabled() throws Exception {
        props.setEnableAuthentication(false);
        CertificateHolder cert = new UninitializedCertificateHolder();

        UdapClientRegistration reg = new UdapClientRegistration(
            props, cert, new OutboundTargetValidator(props));
        reg.onStartup();

        assertFalse(reg.isRegistered());
    }

    @Test
    void startup_skipsWhenCertNotInitialized() throws Exception {
        CertificateHolder cert = new UninitializedCertificateHolder();

        UdapClientRegistration reg = new UdapClientRegistration(
            props, cert, new OutboundTargetValidator(props));
        reg.onStartup();

        assertFalse(reg.isRegistered());
    }

    @Test
    void discoverAndRegister_blocksPrivateTargetBeforeNetworkCall() {
        CertificateHolder cert = assertDoesNotThrow(UdapClientRegistrationTest::testCertificateHolder);
        UdapClientRegistration reg = new UdapClientRegistration(
            props, cert, new OutboundTargetValidator(props));

        UdapClientRegistration.DiscoveryResult result =
            reg.discoverAndRegister("http://169.254.169.254/fhir");

        assertFalse(result.udapEnabled());
        assertNull(result.issuer());
    }

    @Test
    void scopeDefaults() {
        assertEquals("openid udap fhirUser profile", props.getScope());
        assertEquals("Da Vinci Provider", props.getClientName());
    }

    private static CertificateHolder testCertificateHolder() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(false);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        return new CertificateHolder(props);
    }

    private static class UninitializedCertificateHolder extends CertificateHolder {
        UninitializedCertificateHolder() throws Exception {
            super(uninitializedProps());
        }

        private static SecurityProperties uninitializedProps() {
            SecurityProperties props = new SecurityProperties();
            props.setEnableAuthentication(false);
            props.setCertFile(null);
            return props;
        }
    }
}
