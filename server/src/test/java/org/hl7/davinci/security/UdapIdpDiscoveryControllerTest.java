package org.hl7.davinci.security;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class UdapIdpDiscoveryControllerTest {

    @Test
    void uninitializedCert_returns503() throws Exception {
        CertificateHolder holder = mock(CertificateHolder.class);
        when(holder.isInitialized()).thenReturn(false);

        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("http://localhost:8080");
        UdapIdpDiscoveryController controller = new UdapIdpDiscoveryController(holder, props);

        ResponseEntity<Map<String, Object>> response = controller.udapDiscovery(null);
        assertEquals(503, response.getStatusCode().value());
    }

    @Test
    void initializedCert_endpointsPointToProvider() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setCertFile("src/test/resources/test-cert.pfx");
        props.setCertPassword("testpass");
        props.setEnableAuthentication(true);
        props.setServerBaseUrl("http://localhost:8080");
        CertificateHolder holder = new CertificateHolder(props);

        UdapIdpDiscoveryController controller = new UdapIdpDiscoveryController(holder, props);

        ResponseEntity<Map<String, Object>> response = controller.udapDiscovery(null);
        assertEquals(200, response.getStatusCode().value());

        Map<String, Object> body = response.getBody();
        assertNotNull(body);
        assertNotNull(body.get("signed_metadata"));
        assertEquals("http://localhost:8080/oauth2/authorize", body.get("authorization_endpoint"));
        assertEquals("http://localhost:8080/oauth2/token", body.get("token_endpoint"));
        assertEquals("http://localhost:8080/oauth2/register", body.get("registration_endpoint"));
        assertTrue(((java.util.List<?>) body.get("udap_profiles_supported")).contains("udap_to"));
    }
}
