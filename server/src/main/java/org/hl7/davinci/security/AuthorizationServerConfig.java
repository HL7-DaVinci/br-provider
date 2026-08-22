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
import org.springframework.core.Ordered;
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
import org.springframework.security.oauth2.core.OAuth2Token;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.authorization.token.DelegatingOAuth2TokenGenerator;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.JwtGenerator;
import org.springframework.security.oauth2.server.authorization.token.OAuth2AccessTokenGenerator;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenGenerator;
import org.springframework.security.web.SecurityFilterChain;
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
    private final PublicClientRefreshTokenAuthentication publicClientRefreshTokenAuthentication;
    private final ExpiringRequestCache expiringRequestCache;

    public AuthorizationServerConfig(
            SecurityProperties securityProperties,
            FhirUserDetailsService userDetailsService,
            SmartAuthorizationRequestValidator smartAuthorizationRequestValidator,
            SmartPatientLaunchContextFilter smartPatientLaunchContextFilter,
            SmartTokenResponseCustomizer smartTokenResponseCustomizer,
            PublicClientRefreshTokenAuthentication publicClientRefreshTokenAuthentication,
            ExpiringRequestCache expiringRequestCache) {
        this.securityProperties = securityProperties;
        this.userDetailsService = userDetailsService;
        this.smartAuthorizationRequestValidator = smartAuthorizationRequestValidator;
        this.smartPatientLaunchContextFilter = smartPatientLaunchContextFilter;
        this.smartTokenResponseCustomizer = smartTokenResponseCustomizer;
        this.publicClientRefreshTokenAuthentication = publicClientRefreshTokenAuthentication;
        this.expiringRequestCache = expiringRequestCache;
    }

    /**
     * Returns the login page URL. When external-base-url is set (dev mode with
     * SPA on a different port), redirects to the SPA's login page so the user
     * sees the React login form instead of a bare 404 on the backend port.
     * The SPA host follows the host the request came in on when it is an
     * allowed local host, so a flow entered through an alternate host such as
     * host.docker.internal keeps one cookie host for login and resume.
     */
    private String loginUrl(jakarta.servlet.http.HttpServletRequest request) {
        String ext = securityProperties.getExternalBaseUrl();
        if (ext == null || ext.isBlank()) {
            return "/login";
        }
        String base = ext.replaceAll("/+$", "");
        String requestHost = request.getServerName();
        if (requestHost != null && securityProperties.getAllowedLocalHosts().stream()
                .anyMatch(requestHost::equalsIgnoreCase)) {
            try {
                URI extUri = new URI(base);
                if (extUri.getHost() != null && !requestHost.equalsIgnoreCase(extUri.getHost())) {
                    base = new URI(extUri.getScheme(), null, requestHost,
                        extUri.getPort(), extUri.getPath(), null, null).toString();
                }
            } catch (URISyntaxException ignored) {
                // Fall back to the configured external base URL.
            }
        }
        return base + "/login";
    }

    @Bean
    @Order(1)
    public SecurityFilterChain authorizationServerSecurityFilterChain(HttpSecurity http) throws Exception {
        OAuth2AuthorizationServerConfiguration.applyDefaultSecurity(http);
        http.getConfigurer(OAuth2AuthorizationServerConfigurer.class)
            .clientAuthentication(client -> client
                .authenticationConverter(publicClientRefreshTokenAuthentication)
                .authenticationProvider(publicClientRefreshTokenAuthentication))
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

        // Only a browser navigation gets the HTML login redirect. A wildcard
        // Accept header comes from API clients such as the token endpoint's
        // callers, which require an OAuth2 JSON error instead.
        MediaTypeRequestMatcher browserNavigation = new MediaTypeRequestMatcher(MediaType.TEXT_HTML);
        browserNavigation.setIgnoredMediaTypes(Set.of(MediaType.ALL));

        // idp=1 tells the SPA login page that an inbound authorization
        // request (for example Tiered OAuth from a custom target's server)
        // needs the local account form, not a redirect to an external server.
        http.exceptionHandling(exceptions -> exceptions
            .defaultAuthenticationEntryPointFor(
                (request, response, authException) -> response.sendRedirect(loginUrl(request) + "?idp=1"),
                browserNavigation
            )
        );
        http.requestCache(cache -> cache.requestCache(expiringRequestCache));
        http.addFilterAfter(smartPatientLaunchContextFilter, SecurityContextHolderFilter.class);
        return http.build();
    }

    /**
     * Spring Auth Server requires client_id in the token request body even with
     * private_key_jwt authentication. UDAP clients omit it
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
                    sub = com.nimbusds.jwt.SignedJWT.parse(req.getParameter("client_assertion"))
                        .getJWTClaimsSet().getSubject();
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

    /**
     * Registered directly (not via addFilterX into the security chain) so it
     * runs ahead of the Spring Security filter chain, before private_key_jwt
     * authentication tries to fetch the client's key.
     */
    @Bean
    public FilterRegistrationBean<UdapClientAssertionKeyFilter> udapClientAssertionKeyFilterRegistration(
            UdapClientAssertionKeyFilter filter) {
        FilterRegistrationBean<UdapClientAssertionKeyFilter> reg = new FilterRegistrationBean<>(filter);
        reg.addUrlPatterns("/oauth2/token");
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return reg;
    }

    @Bean
    @Order(2)
    public SecurityFilterChain defaultSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll())
            .formLogin(form -> form
                .loginPage("/login")
                .defaultSuccessUrl("/auth/login", false)
                // A form-login failure always comes from the local account
                // form. Keep idp=1 so the retry shows that form again
                // instead of an external sign-in card, and keep the SPA host
                // in dev mode where the default /login?error would 404.
                .failureHandler((request, response, exception) ->
                    response.sendRedirect(loginUrl(request) + "?idp=1&error=bad_credentials")))
            .userDetailsService(userDetailsService)
            .requestCache(cache -> cache.requestCache(expiringRequestCache))
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

    /**
     * Replaces the default token generator so public SMART clients granted
     * offline_access or online_access receive a refresh token.
     */
    @Bean
    public OAuth2TokenGenerator<? extends OAuth2Token> tokenGenerator(
            JWKSource<SecurityContext> jwkSource,
            OAuth2TokenCustomizer<JwtEncodingContext> tokenCustomizer) {
        JwtGenerator jwtGenerator = new JwtGenerator(new NimbusJwtEncoder(jwkSource));
        jwtGenerator.setJwtCustomizer(tokenCustomizer);
        return new DelegatingOAuth2TokenGenerator(
            jwtGenerator,
            new OAuth2AccessTokenGenerator(),
            new SmartRefreshTokenGenerator());
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    /**
     * No fixed issuer: Spring resolves the issuer from each request URL, so
     * clients that reach this server through an alternate allowed host (for
     * example host.docker.internal from a container) get discovery documents
     * and token issuer claims that are reachable from their network.
     */
    @Bean
    public AuthorizationServerSettings authorizationServerSettings() {
        return AuthorizationServerSettings.builder().build();
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
                    if (launchContext.appContext() != null && !launchContext.appContext().isBlank()) {
                        context.getClaims().claim("appContext", launchContext.appContext());
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
