package org.hl7.davinci.security;

import ca.uhn.fhir.interceptor.api.Hook;
import ca.uhn.fhir.interceptor.api.Pointcut;
import com.nimbusds.jwt.JWTClaimsSet;
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

    public AuthInterceptor(
            SecurityProperties securityProperties,
            TokenValidator tokenValidator) {
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
                JWTClaimsSet claims = tokenValidator.validate(authHeader.substring(7));
                // Resource-level access enforcement happens in SmartAuthorizationInterceptor;
                // expose the claims so it can build per-request HAPI rules.
                request.setAttribute(SmartAuthorizationInterceptor.CLAIMS_REQUEST_ATTR, claims);
                logTokenAccess(claims, path);
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

    /**
     * Logs access details for audit. Distinguishes user tokens (with fhirUser)
     * from B2B system tokens (client_credentials, identified by sub only).
     */
    private void logTokenAccess(JWTClaimsSet claims, String path) {
        try {
            String fhirUser = claims.getStringClaim("fhirUser");
            if (fhirUser != null) {
                logger.debug("User token access: fhirUser={}, path={}", fhirUser, path);
            } else {
                String sub = claims.getSubject();
                Object scope = claims.getClaim("scope");
                logger.info("B2B system token access: sub={}, scope={}, path={}", sub, scope, path);
            }
        } catch (Exception e) {
            logger.debug("Failed to extract token claims for audit log", e);
        }
    }
}
