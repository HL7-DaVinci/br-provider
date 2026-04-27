package org.hl7.davinci.security;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Map;
import java.util.function.Consumer;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.endpoint.OAuth2ParameterNames;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationContext;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationException;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class SmartAuthorizationRequestValidator
        implements Consumer<OAuth2AuthorizationCodeRequestAuthenticationContext> {

    private static final String SMART_ERROR_URI = "https://hl7.org/fhir/smart-app-launch/app-launch.html";

    private final SecurityProperties securityProperties;
    private final SmartLaunchService smartLaunchService;

    public SmartAuthorizationRequestValidator(
            SecurityProperties securityProperties,
            SmartLaunchService smartLaunchService) {
        this.securityProperties = securityProperties;
        this.smartLaunchService = smartLaunchService;
    }

    @Override
    public void accept(OAuth2AuthorizationCodeRequestAuthenticationContext context) {
        OAuth2AuthorizationCodeRequestAuthenticationToken request = context.getAuthentication();
        Map<String, Object> additionalParameters = request.getAdditionalParameters();
        if (!isSmartRequest(request)) {
            return;
        }

        if (!StringUtils.hasText(request.getState())) {
            throwError(OAuth2ErrorCodes.INVALID_REQUEST, OAuth2ParameterNames.STATE,
                "SMART authorization requests require state.", request);
        }

        String aud = stringParameter(additionalParameters.get("aud"));
        if (!StringUtils.hasText(aud)) {
            throwError(OAuth2ErrorCodes.INVALID_REQUEST, "aud",
                "SMART authorization requests require aud.", request);
        }
        if (!isAudAllowed(aud)) {
            throwError(OAuth2ErrorCodes.INVALID_REQUEST, "aud",
                "SMART aud must match this server's FHIR base URL.", request);
        }

        String launch = stringParameter(additionalParameters.get("launch"));
        boolean launchScope = request.getScopes().contains("launch");
        if (StringUtils.hasText(launch) && !launchScope) {
            throwError(OAuth2ErrorCodes.INVALID_REQUEST, "launch",
                "EHR launch requests must include the launch scope.", request);
        }
        if (launchScope) {
            if (!StringUtils.hasText(launch)) {
                throwError(OAuth2ErrorCodes.INVALID_REQUEST, "launch",
                    "EHR launch requests must echo the launch parameter.", request);
            }
            if (smartLaunchService.peekLaunchContext(launch) == null) {
                throwError(OAuth2ErrorCodes.INVALID_REQUEST, "launch",
                    "The launch parameter is invalid, expired, or already used.", request);
            }
        }
    }

    private static String stringParameter(Object value) {
        return value instanceof String stringValue ? stringValue : null;
    }

    private static boolean isSmartRequest(OAuth2AuthorizationCodeRequestAuthenticationToken request) {
        if (request.getAdditionalParameters().containsKey("aud")
                || request.getAdditionalParameters().containsKey("launch")) {
            return true;
        }
        return request.getScopes().stream().anyMatch(scope ->
            scope.equals("launch")
                || scope.startsWith("launch/")
                || scope.startsWith("patient/")
                || scope.startsWith("user/"));
    }

    private static String normalize(String value) {
        return value == null ? "" : value.replaceAll("/+$", "");
    }

    /**
     * The aud claim must point at this server's FHIR base, but a single deployment can be
     * reached over several hostnames -- e.g. localhost from a host browser and
     * host.docker.internal from a containerized test client. Accept any aud whose scheme,
     * port, and path match the configured FHIR base URL when its host is listed in
     * allowedLocalHosts.
     */
    private boolean isAudAllowed(String aud) {
        String normalizedAud = normalize(aud);
        String normalizedBase = normalize(securityProperties.getSmartFhirBaseUrl());
        if (normalizedAud.equals(normalizedBase)) {
            return true;
        }
        try {
            URI audUri = new URI(normalizedAud);
            URI baseUri = new URI(normalizedBase);
            if (audUri.getPort() != baseUri.getPort()
                    || !nullSafe(audUri.getScheme()).equalsIgnoreCase(nullSafe(baseUri.getScheme()))
                    || !nullSafe(audUri.getPath()).equals(nullSafe(baseUri.getPath()))) {
                return false;
            }
            String audHost = audUri.getHost();
            if (audHost == null) {
                return false;
            }
            return securityProperties.getAllowedLocalHosts().stream()
                .anyMatch(allowed -> allowed.equalsIgnoreCase(audHost));
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private static String nullSafe(String value) {
        return value == null ? "" : value;
    }

    private static void throwError(
            String errorCode,
            String parameterName,
            String description,
            OAuth2AuthorizationCodeRequestAuthenticationToken request) {
        OAuth2Error error = new OAuth2Error(errorCode, description, SMART_ERROR_URI);
        OAuth2AuthorizationCodeRequestAuthenticationToken result =
            new OAuth2AuthorizationCodeRequestAuthenticationToken(
                request.getAuthorizationUri(),
                request.getClientId(),
                (Authentication) request.getPrincipal(),
                request.getRedirectUri(),
                request.getState(),
                request.getScopes(),
                request.getAdditionalParameters()
            );
        result.setAuthenticated(true);
        throw new OAuth2AuthorizationCodeRequestAuthenticationException(error, result);
    }
}
