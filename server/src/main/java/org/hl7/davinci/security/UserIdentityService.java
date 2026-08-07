package org.hl7.davinci.security;

import java.net.URI;
import java.net.URL;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.net.ssl.SSLContext;
import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.client.interceptor.BearerTokenAuthInterceptor;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import org.hl7.davinci.security.AuthCodeFlowService.PendingFlow;
import org.hl7.davinci.util.UrlMatchUtil;
import org.hl7.fhir.r4.model.HumanName;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * Resolves the display identity of the signed-in user after a token
 * exchange. Sources are tried in order of cost: the local security context,
 * the id_token claims, the authorization server's userinfo endpoint, and
 * finally a read of the fhirUser resource itself.
 */
@Component
public class UserIdentityService {

    private static final Logger logger = LoggerFactory.getLogger(UserIdentityService.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final SecurityProperties securityProperties;
    private final UdapClientRegistration udapClient;
    private final SmartClientDiscoveryService smartDiscovery;
    private final OutboundTargetValidator outboundTargetValidator;
    private final FhirContext fhirContext;

    /**
     * Cached, retrying JWK sources per jwks_uri, so repeated id_token
     * validations against the same server reuse one fetched key set.
     */
    private final ConcurrentHashMap<String, JWKSource<SecurityContext>> idTokenJwkSources =
        new ConcurrentHashMap<>();

    public UserIdentityService(
            SecurityProperties securityProperties,
            UdapClientRegistration udapClient,
            SmartClientDiscoveryService smartDiscovery,
            OutboundTargetValidator outboundTargetValidator,
            FhirContext fhirContext) {
        this.securityProperties = securityProperties;
        this.udapClient = udapClient;
        this.smartDiscovery = smartDiscovery;
        this.outboundTargetValidator = outboundTargetValidator;
        this.fhirContext = fhirContext;
    }

    /**
     * Builds the userinfo map stored in the session after a token exchange.
     * The primary login reads the local security context, since the user
     * authenticated against this server. A custom server needs its own
     * identity sources.
     */
    Map<String, String> resolveUserInfo(PendingFlow flow, Map<String, Object> tokens,
            String serverUrl, boolean isCustomServerFlow) {
        String accessToken = (String) tokens.get("access_token");
        if (!isCustomServerFlow) {
            return localUserInfo();
        }

        Map<String, String> userInfo = new LinkedHashMap<>();

        // Custom server: try id_token claims first (no network call)
        String idToken = (String) tokens.get("id_token");
        String authMethod = flow.resolvedAuthMethod();
        if (idToken != null
                && (!SessionTokenService.isSmartAuthMethod(authMethod) || trustSmartIdToken(flow, idToken))) {
            userInfo = extractClaimsFromIdToken(idToken);
        }

        // Fall back to userinfo endpoint if id_token didn't have fhirUser
        if (!userInfo.containsKey("fhirUser")) {
            UdapClientRegistration.ServerRegistration registration =
                udapClient.getRegistrationForServer(flow.serverUrl());
            if (registration != null && registration.userinfoEndpoint() != null) {
                Map<String, String> userinfoResult = fetchUserinfo(
                    registration.userinfoEndpoint(), accessToken);
                if (!userinfoResult.isEmpty()) {
                    userInfo = userinfoResult;
                }
            }
        }

        // Tiered OAuth through the local IdP leaves the user identity in
        // the local security context even when the id_token omits it.
        if (!userInfo.containsKey("fhirUser")) {
            Map<String, String> local = localUserInfo();
            if (!local.isEmpty()) {
                userInfo = local;
            }
        }

        userInfo.computeIfPresent("fhirUser",
            (key, value) -> relativizeFhirUser(value, serverUrl));

        // Some servers put fhirUser in the id_token but no name claims.
        if (userInfo.containsKey("fhirUser") && !userInfo.containsKey("name")) {
            String resolvedName = resolveFhirUserName(
                userInfo.get("fhirUser"), serverUrl, accessToken);
            if (resolvedName != null) {
                userInfo.put("name", resolvedName);
            }
        }
        return userInfo;
    }

    /**
     * The identity of the user authenticated against this server, or an
     * empty map when no local authentication is in the security context.
     */
    Map<String, String> localUserInfo() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof FhirUserDetails user)) {
            return new LinkedHashMap<>();
        }
        Map<String, String> userInfo = new LinkedHashMap<>();
        userInfo.put("name", user.getDisplayName());
        userInfo.put("fhirUser", user.getFhirResourceReference());
        userInfo.put("fhirUserType", user.getFhirResourceType());
        return userInfo;
    }

    private Map<String, String> fetchUserinfo(String userinfoEndpoint, String accessToken) {
        try {
            HttpClient httpClient = SecurityUtil.getHttpClient(securityProperties);
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(userinfoEndpoint))
                .header("Authorization", "Bearer " + accessToken)
                .header("Accept", "application/json")
                .GET()
                .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                logger.debug("Userinfo endpoint returned HTTP {}", response.statusCode());
                return Map.of();
            }
            Map<String, Object> claims = objectMapper.readValue(response.body(), new TypeReference<>() {});
            return buildUserinfoFromClaims(claims);
        } catch (Exception e) {
            logger.debug("Userinfo fetch failed: {}", e.getMessage());
            return Map.of();
        }
    }

    /**
     * Resolves the fhirUser reference to a display name by reading the
     * resource from the active FHIR server. Only references under that
     * server's base are fetched, so the bearer token never goes to a
     * third party.
     */
    private String resolveFhirUserName(String fhirUser, String serverUrl, String accessToken) {
        try {
            String base = UrlMatchUtil.normalizeUrl(serverUrl);
            String url = fhirUser.startsWith("http") ? fhirUser : base + "/" + fhirUser;
            String resourceType = extractFhirUserType(fhirUser);
            if (resourceType == null || !UrlMatchUtil.matchesBaseUrl(url, serverUrl)) {
                return null;
            }
            IGenericClient client = fhirContext.newRestfulGenericClient(base);
            client.registerInterceptor(new BearerTokenAuthInterceptor(accessToken));
            var resource = client.read().resource(resourceType).withUrl(url).execute();
            return fhirContext.newTerser().getValues(resource, "name").stream()
                .filter(HumanName.class::isInstance)
                .map(name -> ((HumanName) name).getNameAsSingleString())
                .filter(name -> name != null && !name.isBlank())
                .findFirst()
                .orElse(null);
        } catch (Exception e) {
            logger.debug("fhirUser lookup failed: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Validates a SMART flow's id_token before its claims are trusted for
     * display. Rejects (logs a warning, does not fail the exchange) on
     * expiry or an issuer mismatch against the server's discovery document.
     * Verifies the signature against the discovered jwks_uri when advertised.
     * Without one it logs a warning and leaves the claims as display-only.
     */
    private boolean trustSmartIdToken(PendingFlow flow, String idToken) {
        try {
            SignedJWT jwt = SignedJWT.parse(idToken);
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            Date exp = claims.getExpirationTime();
            if (exp != null && exp.before(new Date())) {
                logger.warn("SMART id_token rejected for {}: expired at {}", flow.serverUrl(), exp);
                return false;
            }

            SmartClientDiscoveryService.SmartConfiguration config;
            try {
                config = smartDiscovery.discover(flow.serverUrl());
            } catch (Exception e) {
                logger.warn("SMART discovery unavailable while validating id_token for {}: {}",
                    flow.serverUrl(), e.getMessage());
                return true;
            }

            if (config.issuer() != null && !config.issuer().equals(claims.getIssuer())) {
                logger.warn("SMART id_token rejected for {}: iss {} does not match discovery issuer {}",
                    flow.serverUrl(), claims.getIssuer(), config.issuer());
                return false;
            }

            if (config.jwksUri() == null) {
                logger.warn("SMART id_token signature not verified for {}: no jwks_uri advertised",
                    flow.serverUrl());
                return true;
            }

            try {
                outboundTargetValidator.validate(config.jwksUri());
            } catch (IllegalArgumentException e) {
                logger.warn("SMART id_token rejected for {}: jwks_uri {} failed SSRF validation: {}",
                    flow.serverUrl(), config.jwksUri(), e.getMessage());
                return false;
            }

            JWKSource<SecurityContext> jwkSource = idTokenJwkSources.computeIfAbsent(
                config.jwksUri(), this::buildIdTokenJwkSource);
            DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
            processor.setJWSKeySelector(
                new JWSVerificationKeySelector<>(jwt.getHeader().getAlgorithm(), jwkSource));
            processor.process(jwt, null);
            return true;
        } catch (Exception e) {
            logger.warn("SMART id_token validation failed for {}: {}", flow.serverUrl(), e.getMessage());
            return false;
        }
    }

    /** The JWKS fetch honors the configured TLS policy. */
    private JWKSource<SecurityContext> buildIdTokenJwkSource(String jwksUri) {
        try {
            SSLContext trustAllContext = SecurityUtil.getTrustAllSslContext(securityProperties);
            javax.net.ssl.SSLSocketFactory sslFactory =
                trustAllContext != null ? trustAllContext.getSocketFactory() : null;
            DefaultResourceRetriever retriever = new DefaultResourceRetriever(5000, 5000, 0, true, sslFactory);
            return JWKSourceBuilder.create(new URL(jwksUri), retriever).build();
        } catch (Exception e) {
            throw new IllegalStateException("Invalid jwks_uri: " + jwksUri, e);
        }
    }

    /**
     * Extracts user identity claims from an ID token JWT without signature validation.
     * The token was received over TLS from the authorization server's token endpoint,
     * so transport-level trust is sufficient for claim extraction.
     */
    static Map<String, String> extractClaimsFromIdToken(String idToken) {
        try {
            SignedJWT jwt = SignedJWT.parse(idToken);
            Map<String, Object> claims = jwt.getJWTClaimsSet().getClaims();
            return buildUserinfoFromClaims(claims);
        } catch (Exception e) {
            logger.debug("Failed to extract claims from id_token: {}", e.getMessage());
            return new LinkedHashMap<>();
        }
    }

    static Map<String, String> buildUserinfoFromClaims(Map<String, Object> claims) {
        Map<String, String> userInfo = new LinkedHashMap<>();

        String name = (String) claims.get("name");
        if (name == null) name = (String) claims.get("preferred_username");
        if (name == null) {
            String given = (String) claims.get("given_name");
            String family = (String) claims.get("family_name");
            if (given != null || family != null) {
                name = ((given != null ? given : "") + " " + (family != null ? family : "")).trim();
            }
        }
        if (name == null) name = (String) claims.get("email");
        if (name != null) userInfo.put("name", name);

        String fhirUser = (String) claims.get("fhirUser");
        if (fhirUser != null) {
            userInfo.put("fhirUser", fhirUser);
            String fhirUserType = extractFhirUserType(fhirUser);
            if (fhirUserType != null) {
                userInfo.put("fhirUserType", fhirUserType);
            }
        }
        return userInfo;
    }

    /**
     * Converts an absolute fhirUser URL under the active server's base to
     * the relative Type/id form the SPA and CDS hook contexts expect. A URL
     * under a different base stays absolute, since its id is not valid on
     * the active server.
     */
    static String relativizeFhirUser(String fhirUser, String serverUrl) {
        if (fhirUser == null || serverUrl == null || !fhirUser.startsWith("http")) {
            return fhirUser;
        }
        String base = UrlMatchUtil.normalizeUrl(serverUrl);
        if (!UrlMatchUtil.matchesBaseUrl(fhirUser, base)) {
            return fhirUser;
        }
        String relative = fhirUser.substring(base.length())
            .replaceFirst("^/+", "")
            .replaceFirst("[?#].*", "");
        return relative.isEmpty() ? fhirUser : relative;
    }

    private static String extractFhirUserType(String fhirUser) {
        try {
            URI uri = URI.create(fhirUser);
            String path = uri.getPath();
            if (path != null && !path.isBlank()) {
                String fromPath = extractResourceTypeFromPath(path);
                if (fromPath != null) {
                    return fromPath;
                }
            }
        } catch (IllegalArgumentException e) {
            // Fall through to relative-reference parsing.
        }
        return extractResourceTypeFromPath(fhirUser);
    }

    private static String extractResourceTypeFromPath(String value) {
        String[] segments = value.split("/");
        for (int i = segments.length - 1; i >= 0; i--) {
            String segment = segments[i];
            if (isLikelyFhirResourceType(segment)) {
                return segment;
            }
        }
        return null;
    }

    private static boolean isLikelyFhirResourceType(String segment) {
        if (segment == null || segment.isBlank() || !Character.isUpperCase(segment.charAt(0))) {
            return false;
        }
        for (int i = 0; i < segment.length(); i++) {
            if (!Character.isLetter(segment.charAt(i))) {
                return false;
            }
        }
        return true;
    }
}
