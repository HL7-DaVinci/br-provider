package org.hl7.davinci.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UriUtils;

@Component
public class SmartPatientLaunchContextFilter extends OncePerRequestFilter {

    static final String SAVED_AUTHORIZATION_QUERY = "SMART_SAVED_AUTHORIZATION_QUERY";
    static final String SELECTED_PATIENT_CONTEXT_TOKEN = "SMART_SELECTED_PATIENT_CONTEXT_TOKEN";

    private final FhirUserDetailsService userDetailsService;

    public SmartPatientLaunchContextFilter(FhirUserDetailsService userDetailsService) {
        this.userDetailsService = userDetailsService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (isAuthorizationRequest(request)
                && StringUtils.hasText(request.getParameter(SmartLaunchService.SELECTED_PATIENT_CONTEXT_PARAMETER))
                && !selectionContextMatchesSession(request)) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid SMART patient selection context.");
            return;
        }

        if (requiresPractitionerPatientSelection(request)) {
            request.getSession(true).setAttribute(SAVED_AUTHORIZATION_QUERY, savedAuthorizationQuery(request));
            response.sendRedirect(request.getContextPath() + "/oauth2/smart/select-patient");
            return;
        }

        filterChain.doFilter(request, response);
    }

    private boolean requiresPractitionerPatientSelection(HttpServletRequest request) {
        if (!isAuthorizationRequest(request)) {
            return false;
        }
        if (StringUtils.hasText(request.getParameter("launch"))
                || StringUtils.hasText(request.getParameter(SmartLaunchService.SELECTED_PATIENT_CONTEXT_PARAMETER))) {
            return false;
        }

        String scope = request.getParameter("scope");
        if (scope == null || !(scope.contains("launch/patient") || scope.contains("patient/"))) {
            return false;
        }

        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null
                || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            return false;
        }

        FhirUserDetails user = userDetailsService.getFhirUser(authentication.getName());
        return user != null && "Practitioner".equals(user.getFhirResourceType());
    }

    private boolean isAuthorizationRequest(HttpServletRequest request) {
        String path = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (contextPath != null && !contextPath.isBlank() && path.startsWith(contextPath)) {
            path = path.substring(contextPath.length());
        }
        return "/oauth2/authorize".equals(path) && "GET".equalsIgnoreCase(request.getMethod());
    }

    private static boolean selectionContextMatchesSession(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session == null) {
            return false;
        }
        Object selectedContext = session.getAttribute(SELECTED_PATIENT_CONTEXT_TOKEN);
        return request.getParameter(SmartLaunchService.SELECTED_PATIENT_CONTEXT_PARAMETER).equals(selectedContext);
    }

    private static String savedAuthorizationQuery(HttpServletRequest request) {
        List<String> parts = new ArrayList<>();
        for (Map.Entry<String, String[]> entry : request.getParameterMap().entrySet()) {
            String name = entry.getKey();
            if ("smart_patient_id".equals(name)
                    || SmartLaunchService.SELECTED_PATIENT_CONTEXT_PARAMETER.equals(name)) {
                continue;
            }
            String encodedName = UriUtils.encodeQueryParam(name, StandardCharsets.UTF_8);
            String[] values = entry.getValue();
            if (values == null || values.length == 0) {
                parts.add(encodedName);
                continue;
            }
            for (String value : values) {
                parts.add(encodedName + "=" + UriUtils.encodeQueryParam(value, StandardCharsets.UTF_8));
            }
        }
        return String.join("&", parts);
    }
}
