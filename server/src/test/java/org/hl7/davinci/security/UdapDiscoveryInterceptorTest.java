package org.hl7.davinci.security;

import java.io.ByteArrayOutputStream;
import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class UdapDiscoveryInterceptorTest {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void nonUdapRequest_passesThrough() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("http://localhost:8080");
        CertificateHolder holder = mock(CertificateHolder.class);
        UdapDiscoveryInterceptor interceptor = new UdapDiscoveryInterceptor(props, holder);

        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        when(request.getRequestURI()).thenReturn("/fhir/Patient");

        assertTrue(interceptor.handleUdapDiscovery(request, response));
    }

    @Test
    void uninitializedCert_returns503() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("http://localhost:8080");
        CertificateHolder holder = mock(CertificateHolder.class);
        when(holder.isInitialized()).thenReturn(false);
        UdapDiscoveryInterceptor interceptor = new UdapDiscoveryInterceptor(props, holder);

        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        when(request.getRequestURI()).thenReturn("/fhir/.well-known/udap");
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        when(response.getOutputStream()).thenReturn(toServletOutputStream(baos));

        assertFalse(interceptor.handleUdapDiscovery(request, response));
        verify(response).setStatus(503);
    }

    @Test
    @SuppressWarnings("unchecked")
    void initializedCert_endpointsPointToFastRi() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setIssuer("https://localhost:5001");
        props.setCertFile("src/test/resources/test-cert.pfx");
        props.setCertPassword("testpass");
        props.setEnableAuthentication(true);
        props.setServerBaseUrl("http://localhost:8080");
        CertificateHolder holder = new CertificateHolder(props);

        UdapDiscoveryInterceptor interceptor = new UdapDiscoveryInterceptor(props, holder);

        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        when(request.getRequestURI()).thenReturn("/fhir/.well-known/udap");
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        when(response.getOutputStream()).thenReturn(toServletOutputStream(baos));

        assertFalse(interceptor.handleUdapDiscovery(request, response));
        verify(response).setStatus(200);

        Map<String, Object> body = objectMapper.readValue(baos.toByteArray(), Map.class);
        assertNotNull(body.get("signed_metadata"));
        assertEquals("https://localhost:5001/connect/authorize", body.get("authorization_endpoint"));
        assertEquals("https://localhost:5001/connect/token", body.get("token_endpoint"));
        assertEquals("https://localhost:5001/connect/register", body.get("registration_endpoint"));
        assertFalse(((java.util.List<?>) body.get("udap_profiles_supported")).contains("udap_to"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void signedMetadata_issStrippsFhirSuffix() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setIssuer("https://localhost:5001");
        props.setCertFile("src/test/resources/test-cert.pfx");
        props.setCertPassword("testpass");
        props.setEnableAuthentication(true);
        props.deriveServerBaseUrl("http://localhost:8080/fhir");
        CertificateHolder holder = new CertificateHolder(props);

        UdapDiscoveryInterceptor interceptor = new UdapDiscoveryInterceptor(props, holder);

        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        when(request.getRequestURI()).thenReturn("/fhir/.well-known/udap");
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        when(response.getOutputStream()).thenReturn(toServletOutputStream(baos));

        assertFalse(interceptor.handleUdapDiscovery(request, response));

        Map<String, Object> body = objectMapper.readValue(baos.toByteArray(), Map.class);
        SignedJWT jwt = SignedJWT.parse((String) body.get("signed_metadata"));
        assertEquals("http://localhost:8080", jwt.getJWTClaimsSet().getIssuer());
        assertEquals("http://localhost:8080", jwt.getJWTClaimsSet().getSubject());
    }

    @Test
    @SuppressWarnings("unchecked")
    void signedMetadata_issStrippsFhirSuffixWithTrailingSlash() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setIssuer("https://localhost:5001");
        props.setCertFile("src/test/resources/test-cert.pfx");
        props.setCertPassword("testpass");
        props.setEnableAuthentication(true);
        props.deriveServerBaseUrl("http://localhost:8080/fhir/");
        CertificateHolder holder = new CertificateHolder(props);

        UdapDiscoveryInterceptor interceptor = new UdapDiscoveryInterceptor(props, holder);

        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        when(request.getRequestURI()).thenReturn("/fhir/.well-known/udap");
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        when(response.getOutputStream()).thenReturn(toServletOutputStream(baos));

        assertFalse(interceptor.handleUdapDiscovery(request, response));

        Map<String, Object> body = objectMapper.readValue(baos.toByteArray(), Map.class);
        SignedJWT jwt = SignedJWT.parse((String) body.get("signed_metadata"));
        assertEquals("http://localhost:8080", jwt.getJWTClaimsSet().getIssuer());
        assertEquals("http://localhost:8080", jwt.getJWTClaimsSet().getSubject());
    }

    private static ServletOutputStream toServletOutputStream(ByteArrayOutputStream baos) {
        return new ServletOutputStream() {
            @Override public void write(int b) { baos.write(b); }
            @Override public boolean isReady() { return true; }
            @Override public void setWriteListener(WriteListener listener) {}
        };
    }
}
