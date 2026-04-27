package org.hl7.davinci.security;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.core.oidc.endpoint.OidcParameterNames;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationProvider;
import org.springframework.security.oauth2.server.authorization.config.annotation.web.configuration.OAuth2AuthorizationServerConfiguration;
import org.springframework.security.oauth2.server.authorization.config.annotation.web.configurers.OAuth2AuthorizationServerConfigurer;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AuthorizationCodeRequestAuthenticationValidator;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint;
import org.springframework.security.oauth2.server.authorization.web.authentication.OAuth2AccessTokenResponseAuthenticationSuccessHandler;
import org.springframework.security.web.util.matcher.MediaTypeRequestMatcher;
import org.springframework.security.web.context.SecurityContextHolderFilter;

@Configuration
@EnableWebSecurity
public class AuthorizationServerConfig {

    private final SecurityProperties securityProperties;
    private final FhirUserDetailsService userDetailsService;
    private final SmartAuthorizationRequestValidator smartAuthorizationRequestValidator;
    private final SmartPatientLaunchContextFilter smartPatientLaunchContextFilter;
    private final SmartTokenResponseCustomizer smartTokenResponseCustomizer;

    public AuthorizationServerConfig(
            SecurityProperties securityProperties,
            FhirUserDetailsService userDetailsService,
            SmartAuthorizationRequestValidator smartAuthorizationRequestValidator,
            SmartPatientLaunchContextFilter smartPatientLaunchContextFilter,
            SmartTokenResponseCustomizer smartTokenResponseCustomizer) {
        this.securityProperties = securityProperties;
        this.userDetailsService = userDetailsService;
        this.smartAuthorizationRequestValidator = smartAuthorizationRequestValidator;
        this.smartPatientLaunchContextFilter = smartPatientLaunchContextFilter;
        this.smartTokenResponseCustomizer = smartTokenResponseCustomizer;
    }

    /**
     * Returns the login page URL. When external-base-url is set (dev mode with
     * SPA on a different port), redirects to the SPA's login page so the user
     * sees the React login form instead of a bare 404 on the backend port.
     */
    private String loginUrl() {
        String ext = securityProperties.getExternalBaseUrl();
        return (ext != null && !ext.isBlank()) ? ext.replaceAll("/+$", "") + "/login" : "/login";
    }

    @Bean
    @Order(1)
    public SecurityFilterChain authorizationServerSecurityFilterChain(HttpSecurity http) throws Exception {
        OAuth2AuthorizationServerConfiguration.applyDefaultSecurity(http);
        http.getConfigurer(OAuth2AuthorizationServerConfigurer.class)
            .authorizationEndpoint(authorization -> authorization.authenticationProviders(providers -> {
                for (var provider : providers) {
                    if (provider instanceof OAuth2AuthorizationCodeRequestAuthenticationProvider codeProvider) {
                        codeProvider.setAuthenticationValidator(
                            new OAuth2AuthorizationCodeRequestAuthenticationValidator()
                                .andThen(smartAuthorizationRequestValidator));
                    }
                }
            }))
            .tokenEndpoint(token -> {
                OAuth2AccessTokenResponseAuthenticationSuccessHandler successHandler =
                    new OAuth2AccessTokenResponseAuthenticationSuccessHandler();
                successHandler.setAccessTokenResponseCustomizer(smartTokenResponseCustomizer);
                token.accessTokenResponseHandler(successHandler);
            })
            .oidc(Customizer.withDefaults());

        http.exceptionHandling(exceptions -> exceptions
            .defaultAuthenticationEntryPointFor(
                new LoginUrlAuthenticationEntryPoint(loginUrl()),
                new MediaTypeRequestMatcher(MediaType.TEXT_HTML)
            )
        );
        http.addFilterAfter(smartPatientLaunchContextFilter, SecurityContextHolderFilter.class);
        return http.build();
    }

    /**
     * Spring Auth Server requires client_id in the token request body even with
     * private_key_jwt authentication. The FAST RI (and other UDAP clients) omit it
     * because RFC 6749 considers it optional when the client authenticates via
     * client_assertion. This filter extracts client_id from the JWT assertion's
     * sub claim and injects it into the request when missing.
     */
    @Bean
    public FilterRegistrationBean<jakarta.servlet.Filter> udapTokenClientIdFilter() {
        FilterRegistrationBean<jakarta.servlet.Filter> reg = new FilterRegistrationBean<>();
        reg.setFilter((request, response, chain) -> {
            var req = (jakarta.servlet.http.HttpServletRequest) request;
            if ("/oauth2/token".equals(req.getRequestURI())
                    && "POST".equalsIgnoreCase(req.getMethod())
                    && req.getParameter("client_assertion") != null
                    && req.getParameter("client_id") == null) {
                String sub = null;
                try {
                    // Extract sub (client_id) from the JWT assertion without full validation
                    String assertion = req.getParameter("client_assertion");
                    String[] parts = assertion.split("\\.");
                    if (parts.length == 3) {
                        String payload = new String(java.util.Base64.getUrlDecoder().decode(parts[1]));
                        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                        sub = mapper.readTree(payload).path("sub").asText(null);
                    }
                } catch (Exception e) {
                    LoggerFactory.getLogger("UdapTokenClientIdFilter")
                        .warn("Failed to extract sub from client_assertion", e);
                }
                if (sub != null) {
                    final String clientId = sub;
                    LoggerFactory.getLogger("UdapTokenClientIdFilter")
                        .debug("Injecting client_id={} from JWT assertion sub claim", clientId);
                    var wrapper = new jakarta.servlet.http.HttpServletRequestWrapper(req) {
                        @Override public String getParameter(String name) {
                            return "client_id".equals(name) ? clientId : super.getParameter(name);
                        }
                        @Override public String[] getParameterValues(String name) {
                            return "client_id".equals(name) ? new String[]{clientId} : super.getParameterValues(name);
                        }
                        @Override public java.util.Map<String, String[]> getParameterMap() {
                            var map = new java.util.HashMap<>(super.getParameterMap());
                            map.put("client_id", new String[]{clientId});
                            return map;
                        }
                    };
                    chain.doFilter(wrapper, response);
                    return;
                }
            }
            chain.doFilter(request, response);
        });
        reg.addUrlPatterns("/oauth2/token");
        reg.setOrder(-200);
        return reg;
    }

    @Bean
    @Order(2)
    public SecurityFilterChain defaultSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll())
            .formLogin(form -> form
                .loginPage("/login")
                .defaultSuccessUrl("/auth/login", false))
            .userDetailsService(userDetailsService)
            .csrf(csrf -> csrf
                .ignoringRequestMatchers("/login", "/oauth2/register", "/fhir/**", "/auth/**", "/api/**")
            );
        return http.build();
    }

    @Bean
    public JWKSource<SecurityContext> jwkSource(CertificateHolder certificateHolder) {
        if (!certificateHolder.isInitialized()) {
            return (jwkSelector, context) -> java.util.Collections.emptyList();
        }
        return new ImmutableJWKSet<>(certificateHolder.getJwkSet());
    }

    @Bean
    public JwtDecoder jwtDecoder(JWKSource<SecurityContext> jwkSource) {
        return OAuth2AuthorizationServerConfiguration.jwtDecoder(jwkSource);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    public AuthorizationServerSettings authorizationServerSettings() {
        return AuthorizationServerSettings.builder()
            .issuer(securityProperties.getServerBaseUrl())
            .build();
    }

    @Bean
    public OAuth2TokenCustomizer<JwtEncodingContext> tokenCustomizer(
            FhirUserDetailsService userDetailsService,
            SmartLaunchService smartLaunchService) {
        return context -> {
            // B2B client_credentials tokens have no user context -- skip user claims
            if (AuthorizationGrantType.CLIENT_CREDENTIALS.equals(context.getAuthorizationGrantType())) {
                return;
            }

            String username = context.getPrincipal().getName();
            FhirUserDetails user = userDetailsService.getFhirUser(username);
            if (user == null) return;

            Set<String> scopes = context.getAuthorizedScopes();

            if (OidcParameterNames.ID_TOKEN.equals(context.getTokenType().getValue())) {
                if (isSmartTokenRequest(context)) {
                    context.getClaims().issuer(smartIssuer(context));
                }
                if (scopes.contains("fhirUser") || scopes.contains(OidcScopes.OPENID)) {
                    context.getClaims().claim("fhirUser", user.getFhirResourceReference());
                }
                context.getClaims().claim("name", user.getDisplayName());
            }

            if (OAuth2TokenType.ACCESS_TOKEN.equals(context.getTokenType())) {
                if (isSmartTokenRequest(context)) {
                    context.getClaims().issuer(smartIssuer(context));
                }
                context.getClaims().claim("fhirUser", user.getFhirResourceReference());
                context.getClaims().claim("name", user.getDisplayName());

                if (isSmartTokenRequest(context)) {
                    context.getClaims().audience(List.of(smartAudience(context)));
                }
                SmartLaunchService.ResolvedLaunchContext launchContext =
                    resolveSmartLaunchContext(context, smartLaunchService, user);
                if (launchContext != null) {
                    context.getClaims().claim("patient", launchContext.patientId());
                    if (launchContext.encounterId() != null && !launchContext.encounterId().isBlank()) {
                        context.getClaims().claim("encounter", launchContext.encounterId());
                    }
                    if (!launchContext.fhirContextReferences().isEmpty()) {
                        context.getClaims().claim("fhirContext",
                            fhirContextClaim(launchContext.fhirContextReferences()));
                    }
                    context.getClaims().claim("need_patient_banner", launchContext.needPatientBanner());
                }
            }
        };
    }

    private SmartLaunchService.ResolvedLaunchContext resolveSmartLaunchContext(
            JwtEncodingContext context,
            SmartLaunchService smartLaunchService,
            FhirUserDetails user) {
        if (!AuthorizationGrantType.AUTHORIZATION_CODE.equals(context.getAuthorizationGrantType())) {
            return null;
        }
        OAuth2Authorization authorization = context.getAuthorization();
        if (authorization == null) {
            return null;
        }
        OAuth2AuthorizationRequest request =
            authorization.getAttribute(OAuth2AuthorizationRequest.class.getName());
        if (request == null || !isSmartAuthorizationRequest(request)) {
            return null;
        }

        String launch = stringParameter(request.getAdditionalParameters().get("launch"));
        String selectedPatientContextToken = stringParameter(
            request.getAdditionalParameters().get(SmartLaunchService.SELECTED_PATIENT_CONTEXT_PARAMETER));
        return smartLaunchService.resolveForToken(
            launch,
            context.getAuthorizedScopes(),
            user,
            selectedPatientContextToken
        );
    }

    private String smartIssuer(JwtEncodingContext context) {
        OAuth2AuthorizationRequest request = authorizationRequest(context);
        if (request != null) {
            String issuer = origin(request.getAuthorizationUri());
            if (issuer != null) {
                return issuer;
            }
        }
        return securityProperties.getServerBaseUrl();
    }

    private String smartAudience(JwtEncodingContext context) {
        OAuth2AuthorizationRequest request = authorizationRequest(context);
        if (request != null) {
            String aud = stringParameter(request.getAdditionalParameters().get("aud"));
            if (aud != null && !aud.isBlank()) {
                return aud;
            }
        }
        return securityProperties.getSmartFhirBaseUrl();
    }

    private static OAuth2AuthorizationRequest authorizationRequest(JwtEncodingContext context) {
        OAuth2Authorization authorization = context.getAuthorization();
        if (authorization == null) {
            return null;
        }
        return authorization.getAttribute(OAuth2AuthorizationRequest.class.getName());
    }

    private static String origin(String uriValue) {
        if (uriValue == null || uriValue.isBlank()) {
            return null;
        }
        try {
            URI uri = new URI(uriValue);
            if (uri.getScheme() == null || uri.getRawAuthority() == null) {
                return null;
            }
            return uri.getScheme() + "://" + uri.getRawAuthority();
        } catch (URISyntaxException e) {
            return null;
        }
    }

    private static boolean isSmartTokenRequest(JwtEncodingContext context) {
        if (!AuthorizationGrantType.AUTHORIZATION_CODE.equals(context.getAuthorizationGrantType())) {
            return false;
        }
        OAuth2Authorization authorization = context.getAuthorization();
        if (authorization == null) {
            return false;
        }
        OAuth2AuthorizationRequest request =
            authorization.getAttribute(OAuth2AuthorizationRequest.class.getName());
        return request != null && isSmartAuthorizationRequest(request);
    }

    private static List<Map<String, String>> fhirContextClaim(List<String> references) {
        List<Map<String, String>> values = new ArrayList<>();
        for (String reference : references) {
            Map<String, String> value = new LinkedHashMap<>();
            value.put("reference", reference);
            values.add(value);
        }
        return values;
    }

    private static String stringParameter(Object value) {
        return value instanceof String stringValue ? stringValue : null;
    }

    private static boolean isSmartAuthorizationRequest(OAuth2AuthorizationRequest request) {
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
}
