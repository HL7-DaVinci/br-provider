package org.hl7.davinci.security;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;
import ca.uhn.fhir.interceptor.api.Hook;
import ca.uhn.fhir.interceptor.api.Pointcut;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hl7.davinci.common.BaseInterceptor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * SMART App Launch discovery at /fhir/.well-known/smart-configuration.
 */
@Component
public class SmartConfigurationInterceptor extends BaseInterceptor {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final SecurityProperties securityProperties;

    public SmartConfigurationInterceptor(SecurityProperties securityProperties) {
        this.securityProperties = securityProperties;
    }

    @Hook(Pointcut.SERVER_INCOMING_REQUEST_PRE_HANDLER_SELECTED)
    public boolean handleSmartConfiguration(HttpServletRequest request, HttpServletResponse response) throws Exception {
        if (!request.getRequestURI().endsWith("/.well-known/smart-configuration")) {
            return true;
        }

        response.setStatus(200);
        response.setContentType("application/json");
        objectMapper.writeValue(response.getOutputStream(), metadata(resolveServerRoot(request)));
        return false;
    }

    /**
     * Resolves the server root URL from an allowed Host header so discovery
     * advertises endpoints reachable at the same origin the caller used.
     */
    String resolveServerRoot(HttpServletRequest request) {
        if (request != null) {
            String host = request.getHeader("Host");
            if (StringUtils.hasText(host) && isAllowedHost(host)) {
                return request.getScheme() + "://" + host;
            }
        }
        return securityProperties.getServerBaseUrl();
    }

    Map<String, Object> metadata(String serverRoot) {
        serverRoot = serverRoot.replaceAll("/+$", "");
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("issuer", serverRoot);
        metadata.put("jwks_uri", serverRoot + "/oauth2/jwks");
        metadata.put("authorization_endpoint", serverRoot + "/oauth2/authorize");
        metadata.put("token_endpoint", serverRoot + "/oauth2/token");
        metadata.put("registration_endpoint", serverRoot + "/oauth2/register");
        metadata.put("response_types_supported", List.of("code"));
        metadata.put("grant_types_supported", List.of(
            "authorization_code",
            "refresh_token",
            "client_credentials"
        ));
        metadata.put("token_endpoint_auth_methods_supported", List.of(
            "none",
            "private_key_jwt"
        ));
        metadata.put("token_endpoint_auth_signing_alg_values_supported", List.of("RS256"));
        metadata.put("code_challenge_methods_supported", List.of("S256"));
        metadata.put("scopes_supported", List.copyOf(SmartScopes.supportedScopes()));
        metadata.put("capabilities", List.of(
            "launch-ehr",
            "launch-standalone",
            "client-public",
            "client-confidential-asymmetric",
            "sso-openid-connect",
            "context-ehr-patient",
            "context-ehr-encounter",
            "context-standalone-patient",
            "permission-patient",
            "permission-user"
        ));
        return metadata;
    }

    private boolean isAllowedHost(String hostHeader) {
        String requestHost = hostOnly(hostHeader);
        if (!StringUtils.hasText(requestHost)) {
            return false;
        }
        String configuredHost = hostOnly(securityProperties.getServerBaseUrl());
        if (hostMatches(requestHost, configuredHost)) {
            return true;
        }
        return securityProperties.getAllowedLocalHosts().stream()
            .anyMatch(allowed -> hostMatches(requestHost, allowed));
    }

    private static boolean hostMatches(String left, String right) {
        return stripIpv6Brackets(left).equalsIgnoreCase(stripIpv6Brackets(right));
    }

    private static String hostOnly(String value) {
        if (!StringUtils.hasText(value)) {
            return "";
        }
        try {
            URI uri = value.contains("://") ? new URI(value) : new URI("http://" + value);
            String host = uri.getHost();
            return host != null ? host : "";
        } catch (URISyntaxException e) {
            return "";
        }
    }

    private static String stripIpv6Brackets(String host) {
        if (host != null && host.startsWith("[") && host.endsWith("]")) {
            return host.substring(1, host.length() - 1);
        }
        return host == null ? "" : host;
    }
}
