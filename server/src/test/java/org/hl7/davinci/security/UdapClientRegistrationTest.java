package org.hl7.davinci.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class UdapClientRegistrationTest {

    SecurityProperties props;

    @BeforeEach
    void setUp() {
        props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setIssuer("https://localhost:5001");
    }

    @Test
    void initialState_notRegistered() throws Exception {
        CertificateHolder cert = mock(CertificateHolder.class);
        when(cert.isInitialized()).thenReturn(true);

        UdapClientRegistration reg = new UdapClientRegistration(props, cert);

        assertFalse(reg.isRegistered());
        assertNull(reg.getClientId());
        assertNull(reg.getAuthorizeEndpoint());
        assertNull(reg.getTokenEndpoint());
        assertNull(reg.getRedirectUri());
    }

    @Test
    void startup_skipsWhenAuthDisabled() throws Exception {
        props.setEnableAuthentication(false);
        CertificateHolder cert = mock(CertificateHolder.class);
        when(cert.isInitialized()).thenReturn(false);

        UdapClientRegistration reg = new UdapClientRegistration(props, cert);
        reg.onStartup();

        assertFalse(reg.isRegistered());
    }

    @Test
    void startup_skipsWhenCertNotInitialized() throws Exception {
        CertificateHolder cert = mock(CertificateHolder.class);
        when(cert.isInitialized()).thenReturn(false);

        UdapClientRegistration reg = new UdapClientRegistration(props, cert);
        reg.onStartup();

        assertFalse(reg.isRegistered());
    }

    @Test
    void scopeDefaults() {
        assertEquals("openid udap fhirUser profile", props.getScope());
        assertEquals("Da Vinci Provider", props.getClientName());
    }
}
