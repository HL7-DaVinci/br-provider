package org.hl7.davinci.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.PrintWriter;
import java.io.StringWriter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AuthInterceptorTest {

    SecurityProperties props;
    TokenValidator tokenValidator;
    AuthInterceptor interceptor;
    HttpServletRequest request;
    HttpServletResponse response;

    @BeforeEach
    void setUp() throws Exception {
        props = new SecurityProperties();
        props.setEnableAuthentication(true);
        tokenValidator = mock(TokenValidator.class);

        interceptor = new AuthInterceptor(props, tokenValidator);

        request = mock(HttpServletRequest.class);
        response = mock(HttpServletResponse.class);
        when(response.getWriter()).thenReturn(new PrintWriter(new StringWriter()));
    }

    @Test
    void authDisabled_alwaysPasses() throws Exception {
        props.setEnableAuthentication(false);
        when(request.getRequestURI()).thenReturn("/fhir/Patient");

        assertTrue(interceptor.authenticate(request, response));
    }

    @Test
    void publicEndpoint_passes() throws Exception {
        when(request.getRequestURI()).thenReturn("/fhir/metadata");

        assertTrue(interceptor.authenticate(request, response));
    }

    @Test
    void missingAuthHeader_returns401() throws Exception {
        when(request.getHeader("Authorization")).thenReturn(null);
        when(request.getRequestURI()).thenReturn("/fhir/Patient");

        assertFalse(interceptor.authenticate(request, response));
        verify(response).setStatus(401);
    }

    @Test
    void invalidToken_returns401() throws Exception {
        when(request.getHeader("Authorization")).thenReturn("Bearer bad-token");
        when(request.getRequestURI()).thenReturn("/fhir/Patient");
        when(tokenValidator.validate("bad-token")).thenThrow(new RuntimeException("Invalid"));

        assertFalse(interceptor.authenticate(request, response));
        verify(response).setStatus(401);
    }

    @Test
    void validToken_passes() throws Exception {
        when(request.getHeader("Authorization")).thenReturn("Bearer good-token");
        when(request.getRequestURI()).thenReturn("/fhir/Patient");
        when(tokenValidator.validate("good-token")).thenReturn(
            new com.nimbusds.jwt.JWTClaimsSet.Builder().issuer("https://localhost:5001").build());

        assertTrue(interceptor.authenticate(request, response));
    }
}
