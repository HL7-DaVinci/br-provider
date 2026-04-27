package org.hl7.davinci.security;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * SPA authentication controller for OAuth2 authorization code flow with PKCE.
 * Provides endpoints for login initiation, token exchange (stored server-side
 * in the HTTP session), session status, and logout.
 * Private keys never leave the server; tokens are held in the server session.
 *
 * Single-server-per-session model: one access token is stored in flat session
 * attributes. Switching servers requires a full logout and re-authentication.
 */
@RestController
@RequestMapping("/auth")
public class SpaAuthController {

    private static final Logger logger = LoggerFactory.getLogger(SpaAuthController.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final SecureRandom secureRandom = new SecureRandom();
    private static final long PENDING_FLOW_TTL_SECONDS = 300;

    /** Session attribute holding the access token for the authenticated server */
    public static final String SESSION_ACCESS_TOKEN = "bff.access_token";

    /** Session attribute holding the id token for the authenticated server */
    public static final String SESSION_ID_TOKEN = "bff.id_token";

    /** Session attribute holding the authenticated server's base URL */
    public static final String SESSION_SERVER_URL = "bff.server_url";

    /** Session attribute holding userinfo claims for the authenticated user */
    public static final String SESSION_USERINFO = "bff.userinfo";

    /** Session attribute holding token expiry time */
    public static final String SESSION_TOKEN_EXPIRES_AT = "bff.token_expires_at";

    /** Session attribute holding the refresh token */
    public static final String SESSION_REFRESH_TOKEN = "bff.refresh_token";

    /** Session attribute holding the token endpoint used for the active session */
    public static final String SESSION_TOKEN_ENDPOINT = "bff.token_endpoint";

    /** Session attribute holding the client id used for the active session */
    public static final String SESSION_CLIENT_ID = "bff.client_id";

    private final UdapClientRegistration udapClient;
    private final CertificateHolder certificateHolder;
    private final SecurityProperties securityProperties;
    private final ServerProperties serverProperties;
    private final FhirUserDetailsService userDetailsService;
    private final ConcurrentHashMap<String, PendingFlow> pendingFlows = new ConcurrentHashMap<>();

    /**
     * Tracks an in-progress OAuth authorization code flow.
     * For primary login, serverUrl/tokenEndpoint/clientId are null (use udapClient).
     * For custom server auth, they contain the custom server's registration details.
     */
    record PendingFlow(String codeVerifier, String redirectUri, Instant createdAt,
                       String serverUrl, String tokenEndpoint, String clientId) {
        PendingFlow(String codeVerifier, String redirectUri, Instant createdAt) {
            this(codeVerifier, redirectUri, createdAt, null, null, null);
        }
    }

    public SpaAuthController(
            UdapClientRegistration udapClient,
            CertificateHolder certificateHolder,
            SecurityProperties securityProperties,
            ServerProperties serverProperties,
            FhirUserDetailsService userDetailsService) {
        this.udapClient = udapClient;
        this.certificateHolder = certificateHolder;
        this.securityProperties = securityProperties;
        this.serverProperties = serverProperties;
        this.userDetailsService = userDetailsService;
    }

    /**
     * Stores an access token (and optional id token) for the single authenticated server.
     */
    public static void storeServerToken(HttpSession session, String serverUrl,
            String accessToken, String idToken) {
        storeServerToken(session, serverUrl, accessToken, idToken, null, null, null, null);
    }

    /**
     * Stores an access token with expiry and refresh token for the single authenticated server.
     */
    public static void storeServerToken(HttpSession session, String serverUrl,
            String accessToken, String idToken, Long expiresIn, String refreshToken) {
        storeServerToken(session, serverUrl, accessToken, idToken, expiresIn, refreshToken, null, null);
    }

    /**
     * Stores token metadata required to refresh the active server session.
     */
    public static void storeServerToken(HttpSession session, String serverUrl,
            String accessToken, String idToken, Long expiresIn, String refreshToken,
            String tokenEndpoint, String clientId) {
        String normalized = UrlMatchUtil.normalizeUrl(serverUrl);
        session.setAttribute(SESSION_ACCESS_TOKEN, accessToken);
        session.setAttribute(SESSION_SERVER_URL, normalized);
        if (idToken != null) {
            session.setAttribute(SESSION_ID_TOKEN, idToken);
        }
        if (expiresIn != null) {
            session.setAttribute(SESSION_TOKEN_EXPIRES_AT,
                Instant.now().plusSeconds(expiresIn));
        }
        if (refreshToken != null) {
            session.setAttribute(SESSION_REFRESH_TOKEN, refreshToken);
        }
        if (tokenEndpoint != null) {
            session.setAttribute(SESSION_TOKEN_ENDPOINT, tokenEndpoint);
        }
        if (clientId != null) {
            session.setAttribute(SESSION_CLIENT_ID, clientId);
        }
    }

    /**
     * Returns the stored access token if the target URL matches the authenticated server.
     * Returns null if no matching token exists or the session is null.
     */
    public static String getTokenForServer(HttpSession session, String targetUrl) {
        if (session == null) return null;
        String serverUrl = (String) session.getAttribute(SESSION_SERVER_URL);
        if (serverUrl == null) return null;
        if (!UrlMatchUtil.matchesBaseUrl(targetUrl, serverUrl)) return null;
        return (String) session.getAttribute(SESSION_ACCESS_TOKEN);
    }

    /**
     * Returns true if the session token is expired or within 30 seconds of expiry.
     */
    public static boolean isTokenNearExpiry(HttpSession session) {
        if (session == null) return false;
        Object expiresAtObj = session.getAttribute(SESSION_TOKEN_EXPIRES_AT);
        if (!(expiresAtObj instanceof Instant expiresAt)) return false;
        return Instant.now().isAfter(expiresAt.minusSeconds(30));
    }

    /**
     * Refreshes the session access token using the stored refresh token if the
     * current token is near expiry. No-op if no refresh token is available or
     * the token is still valid.
     */
    public static void refreshTokenIfNeeded(HttpSession session,
            SecurityProperties securityProperties,
            CertificateHolder certificateHolder) {
        if (session == null || !isTokenNearExpiry(session)) return;
        String refreshToken = (String) session.getAttribute(SESSION_REFRESH_TOKEN);
        if (refreshToken == null) return;

        String serverUrl = (String) session.getAttribute(SESSION_SERVER_URL);
        Logger log = LoggerFactory.getLogger(SpaAuthController.class);
        log.info("Refreshing expired token for server: {}", serverUrl);

        try {
            String tokenEndpoint = (String) session.getAttribute(SESSION_TOKEN_ENDPOINT);
            String clientId = (String) session.getAttribute(SESSION_CLIENT_ID);
            if (tokenEndpoint == null || clientId == null) {
                log.warn("Missing refresh token metadata for server: {}", serverUrl);
                return;
            }

            String clientAssertion = buildClientAssertionFor(
                certificateHolder, tokenEndpoint, clientId);
            Map<String, String> params = new LinkedHashMap<>();
            params.put("grant_type", "refresh_token");
            params.put("refresh_token", refreshToken);
            params.put("client_id", clientId);
            params.put("client_assertion_type",
                "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
            params.put("client_assertion", clientAssertion);

            HttpClient httpClient = SecurityUtil.getHttpClient(securityProperties);
            HttpRequest tokenRequest = HttpRequest.newBuilder()
                .uri(URI.create(tokenEndpoint))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(formEncode(params)))
                .build();

            HttpResponse<String> tokenResponse = httpClient.send(
                tokenRequest, HttpResponse.BodyHandlers.ofString());

            if (tokenResponse.statusCode() == 200) {
                ObjectMapper om = new ObjectMapper();
                Map<String, Object> tokens = om.readValue(
                    tokenResponse.body(), new com.fasterxml.jackson.core.type.TypeReference<>() {});
                String newAccessToken = (String) tokens.get("access_token");
                String newRefreshToken = tokens.containsKey("refresh_token")
                    ? (String) tokens.get("refresh_token") : refreshToken;
                Object expiresInObj = tokens.get("expires_in");
                Long expiresIn = expiresInObj instanceof Number n ? n.longValue() : null;

                storeServerToken(session, serverUrl, newAccessToken, null, expiresIn,
                    newRefreshToken, tokenEndpoint, clientId);
                log.info("Token refreshed successfully for server: {}", serverUrl);
            } else {
                log.warn("Token refresh failed: HTTP {} - clearing session", tokenResponse.statusCode());
                session.removeAttribute(SESSION_ACCESS_TOKEN);
                session.removeAttribute(SESSION_TOKEN_EXPIRES_AT);
                session.removeAttribute(SESSION_REFRESH_TOKEN);
                session.removeAttribute(SESSION_TOKEN_ENDPOINT);
                session.removeAttribute(SESSION_CLIENT_ID);
            }
        } catch (Exception e) {
            log.warn("Token refresh error: {}", e.getMessage());
        }
    }

    /**
     * Initiates the UDAP authorization code flow. Without a server parameter,
     * redirects to the primary FAST RI with the idp parameter for Tiered OAuth.
     * With a server parameter, redirects to the custom server's issuer directly
     * (requires prior discovery via /api/servers/discover).
     */
    @GetMapping("/login")
    public ResponseEntity<?> login(
            @RequestParam(name = "server", required = false) String server,
            @RequestParam(name = "idp", required = false) String idp) {
        try {
            if (server != null && !server.isEmpty()) {
                return loginToCustomServer(server, idp);
            }

            udapClient.ensureRegistered();

            String codeVerifier = generateCodeVerifier();
            String codeChallenge = generateCodeChallenge(codeVerifier);
            String state = UUID.randomUUID().toString();
            String redirectUri = udapClient.getRedirectUri();

            pendingFlows.put(state, new PendingFlow(codeVerifier, redirectUri, Instant.now()));

            String authorizeBase = securityProperties.getAuthorizationEndpoint() != null
                ? securityProperties.getAuthorizationEndpoint()
                : udapClient.getAuthorizeEndpoint();
            String requestedScope = buildLoginScope();
            String authorizeUrl = authorizeBase
                + "?response_type=code"
                + "&client_id=" + udapClient.getClientId()
                + "&redirect_uri=" + URI.create(redirectUri).toASCIIString()
                + "&scope=" + URLEncoder.encode(requestedScope, StandardCharsets.UTF_8)
                + "&code_challenge=" + codeChallenge
                + "&code_challenge_method=S256"
                + "&state=" + state
                + "&idp=" + securityProperties.getIdpBaseUrl()
                + "&prompt=login";

            logger.debug("SPA login redirect to: {} (requested scope: {})", authorizeUrl, requestedScope);
            return ResponseEntity.status(302).location(URI.create(authorizeUrl)).build();

        } catch (java.net.ConnectException e) {
            logger.error("Cannot reach authorization server: {}", e.getMessage());
            return redirectToLoginWithError("auth_server_unavailable");
        } catch (Exception e) {
            logger.error("Login initiation failed: {}", e.getMessage(), e);
            return redirectToLoginWithError("login_failed");
        }
    }

    /**
     * Builds the scope string to request from the FAST RI based on the
     * authenticated user's FHIR resource type. Identity scopes from
     * security.scope are always included; resource-access scopes are appended
     * from security.practitioner-scopes or security.patient-scopes per role.
     * If no user is authenticated yet (or their type is unknown), returns
     * identity scopes only -- the resulting token will not authorize any
     * /fhir/... access, which is the correct fail-closed behavior.
     */
    private String buildLoginScope() {
        java.util.LinkedHashSet<String> scopes = new java.util.LinkedHashSet<>();
        for (String s : securityProperties.getScope().split("\\s+")) {
            if (!s.isBlank()) {
                scopes.add(s);
            }
        }
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()) {
            FhirUserDetails user = userDetailsService.getFhirUser(authentication.getName());
            if (user != null) {
                String type = user.getFhirResourceType();
                if ("Practitioner".equals(type)) {
                    scopes.addAll(securityProperties.getPractitionerScopes());
                } else if ("Patient".equals(type)) {
                    scopes.addAll(securityProperties.getPatientScopes());
                }
            }
        }
        return String.join(" ", scopes);
    }

    private ResponseEntity<?> redirectToLoginWithError(String errorCode) {
        String loginPath = "/login?error=" + URLEncoder.encode(errorCode, StandardCharsets.UTF_8);
        String externalBaseUrl = securityProperties.getExternalBaseUrl();
        String loginUrl = (externalBaseUrl == null || externalBaseUrl.isBlank())
            ? loginPath
            : externalBaseUrl.replaceAll("/+$", "") + loginPath;
        return ResponseEntity.status(302).location(URI.create(loginUrl)).build();
    }

    /**
     * Initiates UDAP authentication with a custom FHIR server whose registration
     * was cached during discovery. Uses the registration's authorize endpoint
     * and client_id without the &idp= parameter (not tiered OAuth).
     */
    private ResponseEntity<?> loginToCustomServer(String serverUrl, String idp) throws Exception {
        UdapClientRegistration.ServerRegistration registration =
            udapClient.getRegistrationForServer(serverUrl);
        if (registration == null) {
            udapClient.discoverAndRegister(serverUrl);
            registration = udapClient.getRegistrationForServer(serverUrl);
            if (registration == null) {
                return ResponseEntity.badRequest().body(Map.of(
                    "error", "registration_required",
                    "error_description", "Run discovery first for server: " + serverUrl));
            }
        }

        String codeVerifier = generateCodeVerifier();
        String codeChallenge = generateCodeChallenge(codeVerifier);
        String state = UUID.randomUUID().toString();

        pendingFlows.put(state, new PendingFlow(
            codeVerifier, registration.redirectUri(), Instant.now(),
            serverUrl, registration.tokenEndpoint(), registration.clientId()));

        String scope = securityProperties.getScope();
        String authorizeUrl = registration.authorizeEndpoint()
            + "?response_type=code"
            + "&client_id=" + registration.clientId()
            + "&redirect_uri=" + URI.create(registration.redirectUri()).toASCIIString();

        // When an IdP is specified, include the udap scope (required for Tiered OAuth)
        if (idp != null && !idp.isEmpty()) {
            if (!scope.contains("udap")) {
                scope = scope + " udap";
            }
            authorizeUrl += "&scope=" + scope.replace(" ", "+")
                + "&code_challenge=" + codeChallenge
                + "&code_challenge_method=S256"
                + "&state=" + state
                + "&idp=" + URLEncoder.encode(idp, StandardCharsets.UTF_8);
        } else {
            authorizeUrl += "&scope=" + scope.replace(" ", "+")
                + "&code_challenge=" + codeChallenge
                + "&code_challenge_method=S256"
                + "&state=" + state;
        }

        logger.debug("Custom server auth redirect to: {}", authorizeUrl);
        return ResponseEntity.status(302).location(URI.create(authorizeUrl)).build();
    }

    /**
     * Exchanges an authorization code for tokens using private_key_jwt.
     * Tokens are stored in the server-side HTTP session (BFF pattern),
     * keyed by server URL for per-server token isolation.
     * Handles both primary login and custom server authentication flows
     * based on the PendingFlow context stored with the state parameter.
     */
    @PostMapping("/token")
    public ResponseEntity<Map<String, Object>> exchangeToken(
            @RequestBody Map<String, String> body, HttpServletRequest request) {
        String code = body.get("code");
        String state = body.get("state");

        if (code == null || state == null) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "invalid_request",
                "error_description", "Missing code or state"));
        }

        pruneExpiredFlows();

        PendingFlow flow = pendingFlows.remove(state);
        if (flow == null) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "invalid_state",
                "error_description", "Unknown or expired state parameter"));
        }

        try {
            boolean isCustomServerFlow = flow.serverUrl() != null;
            String tokenEndpoint = isCustomServerFlow
                ? flow.tokenEndpoint() : udapClient.getTokenEndpoint();
            String serverUrl = isCustomServerFlow
                ? flow.serverUrl() : serverProperties.getLocalServerAddress();

            Map<String, String> tokenParams = buildTokenParams(flow, code);

            HttpClient httpClient = SecurityUtil.getHttpClient(securityProperties);
            HttpRequest tokenRequest = HttpRequest.newBuilder()
                .uri(URI.create(tokenEndpoint))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(formEncode(tokenParams)))
                .build();

            HttpResponse<String> tokenResponse = httpClient.send(tokenRequest, HttpResponse.BodyHandlers.ofString());
            if (tokenResponse.statusCode() != 200) {
                logger.error("Token exchange failed: HTTP {} {}", tokenResponse.statusCode(), tokenResponse.body());
                return ResponseEntity.status(502).body(Map.of(
                    "error", "token_exchange_failed",
                    "error_description", "Token exchange with authorization server failed"));
            }

            Map<String, Object> tokens = objectMapper.readValue(
                tokenResponse.body(), new TypeReference<>() {});

            // Store tokens in server-side session, keyed by server URL
            var session = request.getSession(true);
            Object expiresInObj = tokens.get("expires_in");
            Long expiresIn = expiresInObj instanceof Number n ? n.longValue() : null;
            String refreshToken = tokens.containsKey("refresh_token")
                ? (String) tokens.get("refresh_token") : null;
            String clientId = isCustomServerFlow ? flow.clientId() : udapClient.getClientId();
            storeServerToken(session, serverUrl,
                (String) tokens.get("access_token"),
                tokens.containsKey("id_token") ? (String) tokens.get("id_token") : null,
                expiresIn, refreshToken, tokenEndpoint, clientId);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("authenticated", true);
            result.put("serverUrl", UrlMatchUtil.normalizeUrl(serverUrl));

            Map<String, String> userInfo = new LinkedHashMap<>();

            if (!isCustomServerFlow) {
                // Primary login: get userinfo from Spring Security context (local auth)
                Authentication auth = SecurityContextHolder.getContext().getAuthentication();
                if (auth != null && auth.getPrincipal() instanceof FhirUserDetails user) {
                    userInfo.put("name", user.getDisplayName());
                    userInfo.put("fhirUser", user.getFhirResourceReference());
                    userInfo.put("fhirUserType", user.getFhirResourceType());
                }
            } else {
                // Custom server: try id_token claims first (no network call)
                String idToken = (String) tokens.get("id_token");
                if (idToken != null) {
                    userInfo = extractClaimsFromIdToken(idToken);
                }

                // Fall back to userinfo endpoint if id_token didn't have fhirUser
                if (userInfo.isEmpty() || !userInfo.containsKey("fhirUser")) {
                    UdapClientRegistration.ServerRegistration registration =
                        udapClient.getRegistrationForServer(flow.serverUrl());
                    if (registration != null && registration.userinfoEndpoint() != null) {
                        Map<String, String> userinfoResult = fetchUserinfo(
                            registration.userinfoEndpoint(), (String) tokens.get("access_token"));
                        if (!userinfoResult.isEmpty()) {
                            userInfo = userinfoResult;
                        }
                    }
                }
            }

            session.setAttribute(SESSION_USERINFO, userInfo);
            result.put("userinfo", userInfo);

            logger.info("Token exchange completed for server: {}", serverUrl);
            return ResponseEntity.ok(result);

        } catch (Exception e) {
            logger.error("Token exchange error: {}", e.getMessage(), e);
            return ResponseEntity.status(500).body(Map.of(
                "error", "server_error",
                "error_description", "Internal error during token exchange"));
        }
    }

    /**
     * Returns current session authentication state.
     * The SPA calls this on page load to verify the session is still valid.
     * Includes the access token so developers can copy it for use in external
     * tools (Postman, curl, MCP inspector, etc.).
     */
    @GetMapping("/session")
    public ResponseEntity<Map<String, Object>> getSession(HttpServletRequest request) {
        var session = request.getSession(false);
        String serverUrl = (session != null)
            ? (String) session.getAttribute(SESSION_SERVER_URL) : null;

        // BFF session path (OAuth2 flow)
        if (serverUrl != null) {
            // Attempt to refresh the token if it's near expiry
            refreshTokenIfNeeded(session, securityProperties, certificateHolder);

            String accessToken = (String) session.getAttribute(SESSION_ACCESS_TOKEN);

            // If token is expired/missing after refresh attempt, clear the entire
            // session so the stale Spring Security context does not persist
            if (accessToken == null || isTokenNearExpiry(session)) {
                logger.info("Token expired or missing, invalidating session");
                SecurityContextHolder.clearContext();
                session.invalidate();
                return ResponseEntity.ok(Map.of("authenticated", false));
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("authenticated", true);
            result.put("access_token", accessToken);
            result.put("serverUrl", serverUrl);

            // Include token expiry so the frontend can schedule proactive checks
            Object expiresAt = session.getAttribute(SESSION_TOKEN_EXPIRES_AT);
            if (expiresAt instanceof Instant) {
                result.put("expiresAt", expiresAt.toString());
            }

            // Include refresh token presence for debugging
            String refreshToken = (String) session.getAttribute(SESSION_REFRESH_TOKEN);
            result.put("hasRefreshToken", refreshToken != null);

            @SuppressWarnings("unchecked")
            Map<String, String> userInfo = (Map<String, String>) session.getAttribute(SESSION_USERINFO);
            if (userInfo != null && !userInfo.isEmpty()) {
                result.put("userinfo", userInfo);
            }
            return ResponseEntity.ok(result);
        }

        // Fallback: Spring Security form login session
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof FhirUserDetails user) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("authenticated", true);
            result.put("userinfo", Map.of(
                "name", user.getDisplayName(),
                "fhirUser", user.getFhirResourceReference(),
                "fhirUserType", user.getFhirResourceType()));
            return ResponseEntity.ok(result);
        }

        return ResponseEntity.ok(Map.of("authenticated", false));
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
            return Map.of();
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

    private void pruneExpiredFlows() {
        Instant cutoff = Instant.now().minusSeconds(PENDING_FLOW_TTL_SECONDS);
        pendingFlows.entrySet().removeIf(entry -> entry.getValue().createdAt().isBefore(cutoff));
    }

    /**
     * Builds token exchange parameters, selecting the correct token endpoint
     * and client_id based on whether this is a primary or custom server flow.
     */
    Map<String, String> buildTokenParams(PendingFlow flow, String code) throws Exception {
        String tokenEndpoint;
        String clientId;

        if (flow.serverUrl() != null) {
            tokenEndpoint = flow.tokenEndpoint();
            clientId = flow.clientId();
        } else {
            tokenEndpoint = udapClient.getTokenEndpoint();
            clientId = udapClient.getClientId();
        }

        String clientAssertion = buildClientAssertionFor(tokenEndpoint, clientId);
        Map<String, String> tokenParams = new LinkedHashMap<>();
        tokenParams.put("grant_type", "authorization_code");
        tokenParams.put("code", code);
        tokenParams.put("redirect_uri", flow.redirectUri());
        tokenParams.put("code_verifier", flow.codeVerifier());
        tokenParams.put("client_id", clientId);
        tokenParams.put("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
        tokenParams.put("client_assertion", clientAssertion);
        tokenParams.put("udap", "1");
        return tokenParams;
    }

    /**
     * Builds a signed client assertion JWT for the specified token endpoint and client.
     */
    static String buildClientAssertionFor(
            CertificateHolder certificateHolder, String tokenEndpoint, String clientId)
            throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .issuer(clientId)
            .subject(clientId)
            .audience(tokenEndpoint)
            .expirationTime(Date.from(Instant.now().plusSeconds(300)))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .build();

        // FAST RI validates UDAP client assertions using the x5c chain in the header.
        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(certificateHolder.getX509CertChain())
            .build();

        SignedJWT signedJwt = new SignedJWT(header, claims);
        signedJwt.sign(new RSASSASigner(certificateHolder.getSigningKey()));
        return signedJwt.serialize();
    }

    String buildClientAssertionFor(String tokenEndpoint, String clientId) throws Exception {
        return buildClientAssertionFor(certificateHolder, tokenEndpoint, clientId);
    }

    String buildClientAssertion(String tokenEndpoint) throws Exception {
        return buildClientAssertionFor(tokenEndpoint, udapClient.getClientId());
    }

    private static String formEncode(Map<String, String> params) {
        return params.entrySet().stream()
            .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)
                + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
            .collect(Collectors.joining("&"));
    }

    private static String generateCodeVerifier() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String generateCodeChallenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes("US-ASCII"));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
    }

    /**
     * Invalidates the server-side session so the next login presents the form.
     * Clears all per-server token attributes before invalidation to prevent
     * Spring Security's filter chain from re-saving the security context.
     */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        SecurityContextHolder.clearContext();
        var session = request.getSession(false);
        if (session != null) {
            session.removeAttribute(SESSION_ACCESS_TOKEN);
            session.removeAttribute(SESSION_ID_TOKEN);
            session.removeAttribute(SESSION_SERVER_URL);
            session.removeAttribute(SESSION_USERINFO);
            session.removeAttribute(SESSION_TOKEN_ENDPOINT);
            session.removeAttribute(SESSION_CLIENT_ID);
            session.removeAttribute("SPRING_SECURITY_CONTEXT");
            session.invalidate();
        }
        // Clear both cookie names: JSESSIONID (Tomcat default) and SESSION (Spring Session)
        for (String name : new String[]{"JSESSIONID", "SESSION"}) {
            Cookie cookie = new Cookie(name, "");
            cookie.setPath("/");
            cookie.setMaxAge(0);
            cookie.setHttpOnly(true);
            response.addCookie(cookie);
        }
        return ResponseEntity.noContent().build();
    }

    // Visible for testing
    ConcurrentHashMap<String, PendingFlow> getPendingFlows() {
        return pendingFlows;
    }
}
