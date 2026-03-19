package org.hl7.davinci.security;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SecurityPropertiesTest {

    @Test
    void defaultValues() {
        SecurityProperties props = new SecurityProperties();
        assertFalse(props.isEnableAuthentication());
        assertEquals("https://localhost:5001", props.getIssuer());
        assertTrue(props.isFetchCert());
        assertEquals("udap-test", props.getDefaultCertPassword());
        assertEquals("test", props.getDefaultUserPassword());
        assertEquals("X-Bypass-Auth", props.getBypassHeader());
        assertEquals("provider-client", props.getOauthClientId());
        assertFalse(props.isSslVerify());
        assertNotNull(props.getPublicEndpoints());
        assertTrue(props.getPublicEndpoints().contains("/fhir/metadata"));
    }

    @Test
    void settersUpdateValues() {
        SecurityProperties props = new SecurityProperties();
        props.setIssuer("https://custom:443");
        props.setEnableAuthentication(true);
        props.setDefaultUserPassword("secret");
        assertEquals("https://custom:443", props.getIssuer());
        assertTrue(props.isEnableAuthentication());
        assertEquals("secret", props.getDefaultUserPassword());
    }

    @Test
    void deriveServerBaseUrl_stripsFhirSuffix() {
        SecurityProperties props = new SecurityProperties();
        props.deriveServerBaseUrl("http://localhost:8080/fhir");
        assertEquals("http://localhost:8080", props.getServerBaseUrl());
    }

    @Test
    void deriveServerBaseUrl_stripsFhirWithTrailingSlash() {
        SecurityProperties props = new SecurityProperties();
        props.deriveServerBaseUrl("http://localhost:8080/fhir/");
        assertEquals("http://localhost:8080", props.getServerBaseUrl());
    }

    @Test
    void deriveServerBaseUrl_doesNotOverrideExplicitValue() {
        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("https://custom-host:9090");
        props.deriveServerBaseUrl("http://localhost:8080/fhir");
        assertEquals("https://custom-host:9090", props.getServerBaseUrl());
    }

    @Test
    void deriveServerBaseUrl_stripsTrailingSlashWithoutFhir() {
        SecurityProperties props = new SecurityProperties();
        props.deriveServerBaseUrl("http://localhost:8080/");
        assertEquals("http://localhost:8080", props.getServerBaseUrl());
    }
}
