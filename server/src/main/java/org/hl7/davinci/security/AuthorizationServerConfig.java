package org.hl7.davinci.security;

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
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.core.oidc.endpoint.OidcParameterNames;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.config.annotation.web.configuration.OAuth2AuthorizationServerConfiguration;
import org.springframework.security.oauth2.server.authorization.config.annotation.web.configurers.OAuth2AuthorizationServerConfigurer;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint;
import org.springframework.security.web.util.matcher.MediaTypeRequestMatcher;

@Configuration
@EnableWebSecurity
public class AuthorizationServerConfig {

    private final SecurityProperties securityProperties;
    private final FhirUserDetailsService userDetailsService;

    public AuthorizationServerConfig(SecurityProperties securityProperties, FhirUserDetailsService userDetailsService) {
        this.securityProperties = securityProperties;
        this.userDetailsService = userDetailsService;
    }

    /**
     * Returns the login page URL. When external-base-url is set (dev mode with
     * SPA on a different port), redirects to the SPA's login page so the user
     * sees the React login form instead of a bare 404 on the backend port.
     */
    private String loginUrl() {
        String ext = securityProperties.getExternalBaseUrl();
        return (ext != null) ? ext.replaceAll("/+$", "") + "/login" : "/login";
    }

    @Bean
    @Order(1)
    public SecurityFilterChain authorizationServerSecurityFilterChain(HttpSecurity http) throws Exception {
        OAuth2AuthorizationServerConfiguration.applyDefaultSecurity(http);
        http.getConfigurer(OAuth2AuthorizationServerConfigurer.class)
            .oidc(Customizer.withDefaults());

        http.exceptionHandling(exceptions -> exceptions
            .defaultAuthenticationEntryPointFor(
                new LoginUrlAuthenticationEntryPoint(loginUrl()),
                new MediaTypeRequestMatcher(MediaType.TEXT_HTML)
            )
        );
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
            .formLogin(form -> form.loginPage("/login"))
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
        return AuthorizationServerSettings.builder().build();
    }

    @Bean
    public OAuth2TokenCustomizer<JwtEncodingContext> tokenCustomizer(FhirUserDetailsService userDetailsService) {
        return context -> {
            String username = context.getPrincipal().getName();
            FhirUserDetails user = userDetailsService.getFhirUser(username);
            if (user == null) return;

            Set<String> scopes = context.getAuthorizedScopes();

            if (OidcParameterNames.ID_TOKEN.equals(context.getTokenType().getValue())) {
                if (scopes.contains("fhirUser") || scopes.contains(OidcScopes.OPENID)) {
                    context.getClaims().claim("fhirUser", user.getFhirResourceReference());
                }
                context.getClaims().claim("name", user.getDisplayName());
            }

            if (OAuth2TokenType.ACCESS_TOKEN.equals(context.getTokenType())) {
                context.getClaims().claim("fhirUser", user.getFhirResourceReference());
                context.getClaims().claim("name", user.getDisplayName());
            }
        };
    }
}
