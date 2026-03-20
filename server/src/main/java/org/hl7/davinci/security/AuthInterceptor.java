package org.hl7.davinci.security;

import ca.uhn.fhir.interceptor.api.Hook;
import ca.uhn.fhir.interceptor.api.Pointcut;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hl7.davinci.common.BaseInterceptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class AuthInterceptor extends BaseInterceptor {

    private static final Logger logger = LoggerFactory.getLogger(AuthInterceptor.class);

    private final SecurityProperties securityProperties;
    private final TokenValidator tokenValidator;

    public AuthInterceptor(SecurityProperties securityProperties, TokenValidator tokenValidator) {
        this.securityProperties = securityProperties;
        this.tokenValidator = tokenValidator;
    }

    @Hook(Pointcut.SERVER_INCOMING_REQUEST_PRE_HANDLER_SELECTED)
    public boolean authenticate(HttpServletRequest request, HttpServletResponse response) throws Exception {

        if (!securityProperties.isEnableAuthentication()) {
            return true;
        }

        if (request.getHeader(securityProperties.getBypassHeader()) != null) {
            return true;
        }

        String path = request.getRequestURI();
        for (String publicEndpoint : securityProperties.getPublicEndpoints()) {
            if (path.startsWith(publicEndpoint) || path.equals(publicEndpoint)) {
                return true;
            }
        }

        // Bearer token authentication
        String authHeader = request.getHeader("Authorization");
        String errMsg = null;
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            try {
                tokenValidator.validate(authHeader.substring(7));
                return true;
            } catch (Exception e) {
                errMsg = e.getMessage();
                logger.info("Bearer token validation failed: {}", errMsg);
            }
        }

        response.setStatus(401);
        response.setHeader("WWW-Authenticate", "Bearer");
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"invalid_token\",\"error_description\":\"" +
            "No valid Bearer token found: " + errMsg + "\"}");
        return false;
    }
}
