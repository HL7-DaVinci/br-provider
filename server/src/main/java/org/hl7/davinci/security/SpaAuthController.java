package org.hl7.davinci.security;

import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import javax.net.ssl.SSLContext;
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
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jose.util.ResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
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

    /** Default SMART scope requested when a provider server has no configured user scopes. */
    private static final String DEFAULT_SMART_USER_SCOPES = "openid fhirUser offline_access user/*.rs";

    /** Scope requested for an EHR-initiated SMART launch. */
    private static final String SMART_EHR_LAUNCH_SCOPE =
        "launch openid fhirUser patient/*.rs patient/QuestionnaireResponse.cu";

    /** Session attribute holding the access token for the authenticated server */
    public static final String SESSION_ACCESS_TOKEN = "bff.access_token";

    /** Session attribute holding the id token for the authenticated server */
    public static final String SESSION_ID_TOKEN = "bff.id_token";

    /**
     * Session attribute holding the FHIR base URL the SPA is currently
     * pointed at. Set by the OAuth callback (initial login) and by
     * `POST /auth/active-server`. Independent of where any stored token
     * was issued: anonymous selection of a public server can change this
     * without invalidating an authenticated session.
     */
    public static final String SESSION_SERVER_URL = "bff.server_url";

    /**
     * Session attribute holding the FHIR base URL that the stored access
     * token was issued for. Set only by {@link #storeServerToken} during
     * the OAuth code-exchange or refresh. Decoupled from
     * {@link #SESSION_SERVER_URL} so the active server can be switched to
     * an unauthenticated public server without wiping the authentication.
     */
    public static final String SESSION_TOKEN_SERVER_URL = "bff.token_server_url";

    /**
     * Session attribute holding the active payer FHIR base URL. Set by
     * `POST /auth/active-payer` so the FHIR proxy will trust user-selected
     * payer hosts that aren't in the static configured-payer allowlist.
     */
    public static final String SESSION_PAYER_FHIR_URL = "bff.payer_fhir_url";

    /**
     * Session attribute holding the SMART Backend Services client id for the
     * active payer. Only set for payers the user configures in the settings
     * dialog. A payer in app.payer-servers carries its own client-id.
     */
    public static final String SESSION_PAYER_CLIENT_ID = "bff.payer_client_id";

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

    /**
     * Session attribute holding the client secret for a smart-basic session,
     * so a later refresh can rebuild the Basic auth header. Only set for the
     * smart-basic auth method.
     */
    public static final String SESSION_CLIENT_SECRET = "bff.client_secret";

    /**
     * Session attribute holding the auth method used to obtain the active
     * session's token: one of "udap", "smart-none", "smart-basic",
     * "smart-private-key-jwt", or "smart-ehr-launch". Read by
     * {@link #refreshTokenIfNeeded} to select the correct refresh strategy.
     */
    public static final String SESSION_AUTH_METHOD = "bff.auth_method";

    public static final String SESSION_GRANTED_SCOPE = "bff.granted_scope";

    /**
     * Session attribute holding the JWSAlgorithm name used to sign a
     * smart-private-key-jwt session's client assertion, so a later refresh
     * signs with the same algorithm chooseAlg picked at exchange time.
     */
    public static final String SESSION_TOKEN_ALG = "bff.token_alg";

    private final UdapClientRegistration udapClient;
    private final CertificateHolder certificateHolder;
    private final SecurityProperties securityProperties;
    private final ServerProperties serverProperties;
    private final FhirUserDetailsService userDetailsService;
    private final OutboundTargetValidator outboundTargetValidator;
    private final SmartClientDiscoveryService smartDiscovery;
    private final SmartClientKeyService smartClientKeyService;
    private final ConcurrentHashMap<String, PendingFlow> pendingFlows = new ConcurrentHashMap<>();

    /**
     * Tracks an in-progress OAuth authorization code flow.
     * For primary login, serverUrl/tokenEndpoint/clientId are null (use udapClient).
     * For custom server auth, they contain the custom server's registration details.
     * authMethod is one of "udap", "smart-none", "smart-basic",
     * "smart-private-key-jwt", or "smart-ehr-launch". clientSecret and launch
     * are only populated for the SMART flows that need them.
     */
    record PendingFlow(String codeVerifier, String redirectUri, Instant createdAt,
                       String serverUrl, String tokenEndpoint, String clientId,
                       String authMethod, String clientSecret, String launch,
                       String requestedScope) {
        PendingFlow(String codeVerifier, String redirectUri, Instant createdAt) {
            this(codeVerifier, redirectUri, createdAt, null, null, null, "udap", null, null, null);
        }

        PendingFlow(String codeVerifier, String redirectUri, Instant createdAt,
                    String serverUrl, String tokenEndpoint, String clientId, String requestedScope) {
            this(codeVerifier, redirectUri, createdAt, serverUrl, tokenEndpoint, clientId,
                "udap", null, null, requestedScope);
        }
    }

    public SpaAuthController(
            UdapClientRegistration udapClient,
            CertificateHolder certificateHolder,
            SecurityProperties securityProperties,
            ServerProperties serverProperties,
            FhirUserDetailsService userDetailsService,
            OutboundTargetValidator outboundTargetValidator,
            SmartClientDiscoveryService smartDiscovery,
            SmartClientKeyService smartClientKeyService) {
        this.udapClient = udapClient;
        this.certificateHolder = certificateHolder;
        this.securityProperties = securityProperties;
        this.serverProperties = serverProperties;
        this.userDetailsService = userDetailsService;
        this.outboundTargetValidator = outboundTargetValidator;
        this.smartDiscovery = smartDiscovery;
        this.smartClientKeyService = smartClientKeyService;
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
        storeServerToken(session, serverUrl, accessToken, idToken, expiresIn, refreshToken,
            tokenEndpoint, clientId, "udap");
    }

    /**
     * Stores token metadata required to refresh the active server session,
     * recording the auth method used so a later refresh can select the
     * matching strategy.
     */
    public static void storeServerToken(HttpSession session, String serverUrl,
            String accessToken, String idToken, Long expiresIn, String refreshToken,
            String tokenEndpoint, String clientId, String authMethod) {
        String normalized = UrlMatchUtil.normalizeUrl(serverUrl);
        session.setAttribute(SESSION_ACCESS_TOKEN, accessToken);
        session.setAttribute(SESSION_TOKEN_SERVER_URL, normalized);
        // Also seed the active-server URL on first-time login so a freshly
        // authenticated session has a sensible default. POST /auth/active-server
        // (boot-sync from the SPA's localStorage) can override this later.
        if (session.getAttribute(SESSION_SERVER_URL) == null) {
            session.setAttribute(SESSION_SERVER_URL, normalized);
        }
        // Absent values clear their attributes so a replacement token bundle
        // cannot inherit refresh credentials from the previous server.
        setOrRemove(session, SESSION_ID_TOKEN, idToken);
        setOrRemove(session, SESSION_TOKEN_EXPIRES_AT,
            expiresIn != null ? Instant.now().plusSeconds(expiresIn) : null);
        setOrRemove(session, SESSION_REFRESH_TOKEN, refreshToken);
        setOrRemove(session, SESSION_TOKEN_ENDPOINT, tokenEndpoint);
        setOrRemove(session, SESSION_CLIENT_ID, clientId);
        session.setAttribute(SESSION_AUTH_METHOD, authMethod != null ? authMethod : "udap");
    }

    private static void setOrRemove(HttpSession session, String name, Object value) {
        if (value != null) {
            session.setAttribute(name, value);
        } else {
            session.removeAttribute(name);
        }
    }

    /**
     * Records the active provider FHIR server URL for the session.
     *
     * Independent of the auth bundle: the stored token (if any) stays
     * tied to {@link #SESSION_TOKEN_SERVER_URL}, so switching the active
     * server to an unauthenticated public host does not destroy the
     * existing session. {@link #getTokenForServer} only returns the token
     * when the requested URL matches the auth URL, so an active=public,
     * auth=local session sends anonymous calls to public and bearer
     * calls to local — both correct.
     */
    public static void setActiveServer(HttpSession session, String url) {
        if (session == null) return;
        if (url == null || url.isBlank()) {
            throw new IllegalArgumentException("url is required");
        }
        String normalized = UrlMatchUtil.normalizeUrl(url);
        session.setAttribute(SESSION_SERVER_URL, normalized);
    }

    /**
     * Returns the stored access token if the target URL matches the URL the
     * token was issued for ({@link #SESSION_TOKEN_SERVER_URL}). The active
     * SPA server ({@link #SESSION_SERVER_URL}) is intentionally NOT used
     * here: those two can diverge when the user picks a public/anonymous
     * server, and the token must only be sent to its origin.
     */
    public static String getTokenForServer(HttpSession session, String targetUrl) {
        if (session == null) return null;
        String tokenServerUrl = (String) session.getAttribute(SESSION_TOKEN_SERVER_URL);
        if (tokenServerUrl == null) return null;
        if (!UrlMatchUtil.matchesBaseUrl(targetUrl, tokenServerUrl)) return null;
        // A near-expired token with no refresh token cannot be replaced.
        // Report it as absent so callers fall back to other token sources.
        if (isTokenNearExpiry(session) && session.getAttribute(SESSION_REFRESH_TOKEN) == null) {
            return null;
        }
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
            CertificateHolder certificateHolder,
            SmartClientKeyService smartClientKeyService) {
        if (session == null || !isTokenNearExpiry(session)) return;
        refreshToken(session, securityProperties, certificateHolder, smartClientKeyService);
    }

    /**
     * Refreshes the session access token whatever its expiry says, for a caller
     * that saw the target reject the token early. Returns true when a new token
     * is in the session. A failed refresh clears the stored token.
     */
    public static boolean refreshToken(HttpSession session,
            SecurityProperties securityProperties,
            CertificateHolder certificateHolder,
            SmartClientKeyService smartClientKeyService) {
        if (session == null) return false;
        String refreshToken = (String) session.getAttribute(SESSION_REFRESH_TOKEN);
        if (refreshToken == null) return false;

        String serverUrl = (String) session.getAttribute(SESSION_TOKEN_SERVER_URL);
        Logger log = LoggerFactory.getLogger(SpaAuthController.class);
        if (serverUrl == null) {
            log.warn("Missing token server URL for refresh token");
            return false;
        }
        log.info("Refreshing expired token for server: {}", serverUrl);

        try {
            String tokenEndpoint = (String) session.getAttribute(SESSION_TOKEN_ENDPOINT);
            String clientId = (String) session.getAttribute(SESSION_CLIENT_ID);
            if (tokenEndpoint == null || clientId == null) {
                log.warn("Missing refresh token metadata for server: {}", serverUrl);
                return false;
            }
            String authMethod = (String) session.getAttribute(SESSION_AUTH_METHOD);

            Map<String, String> params = new LinkedHashMap<>();
            params.put("grant_type", "refresh_token");
            params.put("refresh_token", refreshToken);
            String basicAuthHeader = null;

            if (isSmartAuthMethod(authMethod)) {
                switch (authMethod) {
                    case "smart-basic" -> {
                        String clientSecret = (String) session.getAttribute(SESSION_CLIENT_SECRET);
                        basicAuthHeader = "Basic " + Base64.getEncoder().encodeToString(
                            (clientId + ":" + clientSecret).getBytes(StandardCharsets.UTF_8));
                    }
                    case "smart-private-key-jwt" -> {
                        String storedAlg = (String) session.getAttribute(SESSION_TOKEN_ALG);
                        JWSAlgorithm alg = storedAlg != null ? JWSAlgorithm.parse(storedAlg) : JWSAlgorithm.RS384;
                        params.put("client_assertion_type",
                            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
                        params.put("client_assertion", smartClientKeyService.buildClientAssertion(
                            clientId, tokenEndpoint, alg));
                    }
                    default -> params.put("client_id", clientId); // smart-none, smart-ehr-launch
                }
            } else {
                String clientAssertion = buildClientAssertionFor(
                    certificateHolder, tokenEndpoint, clientId);
                params.put("client_id", clientId);
                params.put("client_assertion_type",
                    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
                params.put("client_assertion", clientAssertion);
            }

            HttpClient httpClient = SecurityUtil.getHttpClient(securityProperties);
            HttpRequest.Builder tokenRequestBuilder = HttpRequest.newBuilder()
                .uri(URI.create(tokenEndpoint))
                .header("Content-Type", "application/x-www-form-urlencoded");
            if (basicAuthHeader != null) {
                tokenRequestBuilder.header("Authorization", basicAuthHeader);
            }
            HttpRequest tokenRequest = tokenRequestBuilder
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
                    newRefreshToken, tokenEndpoint, clientId, authMethod);
                // A token response omits scope when it is unchanged from the request,
                // so an absent scope keeps the previously granted set.
                Object scopeObj = tokens.get("scope");
                if (scopeObj instanceof String s) {
                    session.setAttribute(SESSION_GRANTED_SCOPE, s);
                }
                log.info("Token refreshed successfully for server: {}", serverUrl);
                return newAccessToken != null;
            } else {
                log.warn("Token refresh failed: HTTP {} - clearing session", tokenResponse.statusCode());
                session.removeAttribute(SESSION_ACCESS_TOKEN);
                session.removeAttribute(SESSION_TOKEN_SERVER_URL);
                session.removeAttribute(SESSION_TOKEN_EXPIRES_AT);
                session.removeAttribute(SESSION_REFRESH_TOKEN);
                session.removeAttribute(SESSION_TOKEN_ENDPOINT);
                session.removeAttribute(SESSION_CLIENT_ID);
                session.removeAttribute(SESSION_CLIENT_SECRET);
                session.removeAttribute(SESSION_AUTH_METHOD);
                session.removeAttribute(SESSION_GRANTED_SCOPE);
                session.removeAttribute(SESSION_TOKEN_ALG);
            }
        } catch (Exception e) {
            log.warn("Token refresh error: {}", e.getMessage());
        }
        return false;
    }

    private static boolean isSmartAuthMethod(String authMethod) {
        return authMethod != null && authMethod.startsWith("smart-");
    }

    /**
     * Initiates the UDAP authorization code flow. Without a server parameter,
     * redirects to the primary issuer with the idp parameter for Tiered OAuth.
     * With a server parameter, redirects to the custom server's issuer directly
     * (requires prior discovery via /api/servers/discover).
     */
    @GetMapping("/login")
    public ResponseEntity<?> login(
            @RequestParam(name = "server", required = false) String server,
            @RequestParam(name = "idp", required = false) String idp,
            @RequestParam(name = "mode", required = false) String mode,
            @RequestParam(name = "clientId", required = false) String clientId) {
        try {
            if (server != null && !server.isEmpty()) {
                return loginToCustomServer(server, idp, mode, clientId);
            }

            // Refresh the registration (subject to its cooldown) so the
            // redirect never carries a client_id the authorization server
            // has forgotten, e.g. after its database was reset.
            udapClient.ensureFreshRegistration();

            String codeVerifier = generateCodeVerifier();
            String codeChallenge = generateCodeChallenge(codeVerifier);
            String state = UUID.randomUUID().toString();
            String redirectUri = udapClient.getRedirectUri();

            String authorizeBase = securityProperties.getAuthorizationEndpoint() != null
                ? securityProperties.getAuthorizationEndpoint()
                : udapClient.getAuthorizeEndpoint();
            String requestedScope = buildLoginScope();

            // Snapshot the token endpoint and client_id so this flow's code
            // exchange is unaffected by a later re-registration.
            pendingFlows.put(state, new PendingFlow(codeVerifier, redirectUri, Instant.now(),
                null, udapClient.getTokenEndpoint(), udapClient.getClientId(), requestedScope));

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
     * Builds the scope string to request from the authorization server based on the
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
     * Initiates authentication with a custom FHIR server: UDAP when the
     * server advertises UDAP support, SMART App Launch otherwise.
     * {@code mode} forces the SMART branch and skips the UDAP probe.
     */
    private ResponseEntity<?> loginToCustomServer(
            String serverUrl, String idp, String mode, String clientId) throws Exception {
        if (!"smart".equals(mode)) {
            // Force a fresh DCR so the redirect never carries a stale client_id.
            // A cached registration is the fallback when the DCR fails.
            UdapClientRegistration.DiscoveryResult discovery =
                udapClient.discoverAndRegister(serverUrl, true);
            if (discovery.udapEnabled()) {
                UdapClientRegistration.ServerRegistration registration =
                    udapClient.getRegistrationForServer(serverUrl);
                if (registration == null) {
                    return ResponseEntity.badRequest().body(Map.of(
                        "error", "registration_required",
                        "error_description", "Run discovery first for server: " + serverUrl));
                }
                return loginToUdapCustomServer(serverUrl, idp, registration);
            }
            // Server has no /.well-known/udap: fall through to SMART.
        }
        return loginToSmartServer(serverUrl, clientId);
    }

    /**
     * Initiates UDAP authentication with a custom FHIR server whose registration
     * was cached during discovery. Uses the registration's authorize endpoint
     * and client_id without the &idp= parameter (not tiered OAuth).
     */
    private ResponseEntity<?> loginToUdapCustomServer(
            String serverUrl, String idp, UdapClientRegistration.ServerRegistration registration)
            throws Exception {
        String codeVerifier = generateCodeVerifier();
        String codeChallenge = generateCodeChallenge(codeVerifier);
        String state = UUID.randomUUID().toString();

        String scope = buildLoginScope();

        pendingFlows.put(state, new PendingFlow(
            codeVerifier, registration.redirectUri(), Instant.now(),
            serverUrl, registration.tokenEndpoint(), registration.clientId(), scope));

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
     * Initiates SMART App Launch standalone authentication with a custom
     * FHIR server that has no UDAP support (or when the caller explicitly
     * requested SMART via mode=smart). Discovers the server's SMART
     * configuration, resolves a client_id from the request or the provider's
     * configured settings, and redirects to the server's authorize endpoint
     * with PKCE.
     */
    private ResponseEntity<?> loginToSmartServer(String serverUrl, String clientId) throws Exception {
        SmartClientDiscoveryService.SmartConfiguration smartConfig;
        try {
            smartConfig = smartDiscovery.discover(serverUrl);
        } catch (Exception e) {
            logger.warn("SMART discovery failed for {}: {}", serverUrl, e.getMessage());
            return redirectToLoginWithError("smart_discovery_failed");
        }
        if (!smartConfig.supportsUserLogin()) {
            return redirectToLoginWithError("smart_server_unsupported");
        }

        // The authorize endpoint is sent to the browser and the token endpoint
        // is later POSTed to server-side. The discovery document can influence
        // both, so both must clear the same SSRF gate UDAP registration uses
        // for its discovered endpoints.
        try {
            outboundTargetValidator.validate(smartConfig.authorizationEndpoint());
            outboundTargetValidator.validate(smartConfig.tokenEndpoint());
        } catch (IllegalArgumentException e) {
            logger.warn("SMART endpoint rejected for {}: {}", serverUrl, e.getMessage());
            return redirectToLoginWithError("smart_server_unsupported");
        }

        ServerProperties.ProviderServer configured = serverProperties.findProviderByUrl(serverUrl);
        String resolvedClientId = clientId != null && !clientId.isBlank()
            ? clientId
            : configured != null ? configured.getUserClientId() : null;
        if (resolvedClientId == null) {
            return redirectToLoginWithError("smart_client_not_configured");
        }

        String authMethod = resolveSmartAuthMethod(configured, smartConfig);
        String scope = configured != null && configured.getUserScopes() != null
            ? configured.getUserScopes() : DEFAULT_SMART_USER_SCOPES;
        String codeVerifier = generateCodeVerifier();
        String state = UUID.randomUUID().toString();
        String redirectUri = resolveSpaRedirectUri();

        pendingFlows.put(state, new PendingFlow(codeVerifier, redirectUri, Instant.now(),
            serverUrl, smartConfig.tokenEndpoint(), resolvedClientId, authMethod,
            configured != null ? configured.getUserClientSecret() : null, null, scope));

        String authorizeUrl = smartConfig.authorizationEndpoint()
            + "?response_type=code"
            + "&client_id=" + URLEncoder.encode(resolvedClientId, StandardCharsets.UTF_8)
            + "&redirect_uri=" + URI.create(redirectUri).toASCIIString()
            + "&scope=" + URLEncoder.encode(scope, StandardCharsets.UTF_8)
            + "&state=" + state
            + "&aud=" + URLEncoder.encode(UrlMatchUtil.normalizeUrl(serverUrl), StandardCharsets.UTF_8)
            + "&code_challenge=" + generateCodeChallenge(codeVerifier)
            + "&code_challenge_method=S256";

        logger.debug("SMART custom server auth redirect to: {}", authorizeUrl);
        return ResponseEntity.status(302).location(URI.create(authorizeUrl)).build();
    }

    /**
     * Starts a SMART EHR launch: an external EHR opened the SPA with
     * {@code iss} and {@code launch} query parameters. Discovers the issuer's
     * SMART configuration, validates it the same way {@link #loginToSmartServer}
     * does, and returns the authorize URL as JSON so the SPA performs the
     * redirect itself (keeps this endpoint CORS-free and testable).
     */
    @PostMapping("/smart-ehr-launch")
    public ResponseEntity<Map<String, Object>> smartEhrLaunch(
            @RequestBody Map<String, String> body, HttpServletRequest request) throws Exception {
        String iss = body.get("iss");
        String launch = body.get("launch");
        String requestClientId = body.get("clientId");

        if (iss == null || iss.isBlank() || launch == null || launch.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "invalid_request",
                "error_description", "Missing iss or launch"));
        }

        try {
            outboundTargetValidator.validate(iss);
        } catch (IllegalArgumentException e) {
            logger.warn("Rejecting smart-ehr-launch iss {}: {}", iss, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of(
                "error", "invalid_request",
                "error_description", e.getMessage()));
        }

        SmartClientDiscoveryService.SmartConfiguration smartConfig;
        try {
            smartConfig = smartDiscovery.discover(iss);
        } catch (Exception e) {
            logger.warn("SMART discovery failed for {}: {}", iss, e.getMessage());
            return ResponseEntity.status(502).body(Map.of(
                "error", "smart_discovery_failed",
                "error_description", "SMART discovery failed for " + iss));
        }
        if (!smartConfig.supportsUserLogin()) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "smart_server_unsupported",
                "error_description", "Server does not support required SMART capabilities"));
        }

        try {
            outboundTargetValidator.validate(smartConfig.authorizationEndpoint());
            outboundTargetValidator.validate(smartConfig.tokenEndpoint());
        } catch (IllegalArgumentException e) {
            logger.warn("SMART endpoint rejected for {}: {}", iss, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of(
                "error", "smart_server_unsupported",
                "error_description", "Server endpoints failed SSRF validation"));
        }

        ServerProperties.ProviderServer configured = serverProperties.findProviderByUrl(iss);
        // The fallback client is registered with this server's own authorization server.
        String resolvedClientId = requestClientId != null && !requestClientId.isBlank()
            ? requestClientId
            : configured != null && configured.getUserClientId() != null
                ? configured.getUserClientId()
                : securityProperties.getSmartPublicClientId();

        String codeVerifier = generateCodeVerifier();
        String state = UUID.randomUUID().toString();
        String redirectUri = resolveSpaRedirectUri();

        // Only widen the session's proxy allowlist once every gate has
        // passed: a failed launch must not leave the session trusting a
        // target that never completed validation.
        HttpSession session = request.getSession(true);
        setActiveServer(session, iss);

        pendingFlows.put(state, new PendingFlow(codeVerifier, redirectUri, Instant.now(),
            iss, smartConfig.tokenEndpoint(), resolvedClientId, "smart-ehr-launch", null, launch,
            SMART_EHR_LAUNCH_SCOPE));

        String authorizeUrl = smartConfig.authorizationEndpoint()
            + "?response_type=code"
            + "&client_id=" + URLEncoder.encode(resolvedClientId, StandardCharsets.UTF_8)
            + "&redirect_uri=" + URI.create(redirectUri).toASCIIString()
            + "&scope=" + URLEncoder.encode(SMART_EHR_LAUNCH_SCOPE, StandardCharsets.UTF_8)
            + "&state=" + state
            + "&aud=" + URLEncoder.encode(UrlMatchUtil.normalizeUrl(iss), StandardCharsets.UTF_8)
            + "&code_challenge=" + generateCodeChallenge(codeVerifier)
            + "&code_challenge_method=S256"
            + "&launch=" + URLEncoder.encode(launch, StandardCharsets.UTF_8);

        logger.debug("SMART EHR launch redirect to: {}", authorizeUrl);
        return ResponseEntity.ok(Map.of("authorizeUrl", authorizeUrl));
    }

    /**
     * An explicit none forces a public client even when a secret is configured.
     * Any other unrecognized value infers the method from the secret instead.
     */
    String resolveSmartAuthMethod(ServerProperties.ProviderServer configured,
            SmartClientDiscoveryService.SmartConfiguration smartConfig) {
        String method = configured != null ? configured.getUserAuthMethod() : null;
        if ("basic".equals(method)) {
            return "smart-basic";
        }
        if ("private_key_jwt".equals(method)) {
            return "smart-private-key-jwt";
        }
        if ("none".equals(method)) {
            return "smart-none";
        }
        if (method != null) {
            logger.warn("Unrecognized user-auth-method '{}'; inferring auth method from configuration", method);
        }
        if (configured != null && configured.getUserClientSecret() != null
                && !configured.getUserClientSecret().isBlank()) {
            return "smart-basic";
        }
        return "smart-none";
    }

    /**
     * Builds the SPA's OAuth callback redirect URI the same way the UDAP
     * flow does, without depending on a live UDAP registration (a SMART-only
     * server may never have one).
     */
    private String resolveSpaRedirectUri() {
        return UdapClientRegistration.buildRedirectUri(securityProperties);
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
            String tokenEndpoint = flow.tokenEndpoint() != null
                ? flow.tokenEndpoint() : udapClient.getTokenEndpoint();
            String serverUrl = isCustomServerFlow
                ? flow.serverUrl() : serverProperties.getLocalServerAddress();

            TokenRequestSpec tokenRequestSpec = buildTokenRequest(flow, code);

            HttpClient httpClient = SecurityUtil.getHttpClient(securityProperties);
            HttpRequest.Builder tokenRequestBuilder = HttpRequest.newBuilder()
                .uri(URI.create(tokenEndpoint))
                .header("Content-Type", "application/x-www-form-urlencoded");
            if (tokenRequestSpec.basicAuthHeader() != null) {
                tokenRequestBuilder.header("Authorization", tokenRequestSpec.basicAuthHeader());
            }
            HttpRequest tokenRequest = tokenRequestBuilder
                .POST(HttpRequest.BodyPublishers.ofString(formEncode(tokenRequestSpec.params())))
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
            String clientId = flow.clientId() != null ? flow.clientId() : udapClient.getClientId();
            String authMethod = flow.authMethod() != null ? flow.authMethod() : "udap";
            storeServerToken(session, serverUrl,
                (String) tokens.get("access_token"),
                tokens.containsKey("id_token") ? (String) tokens.get("id_token") : null,
                expiresIn, refreshToken, tokenEndpoint, clientId, authMethod);
            // A token response omits scope when it is unchanged from the request.
            Object scopeObj = tokens.get("scope");
            session.setAttribute(SESSION_GRANTED_SCOPE,
                scopeObj instanceof String s ? s : flow.requestedScope());
            if ("smart-basic".equals(authMethod) && flow.clientSecret() != null) {
                session.setAttribute(SESSION_CLIENT_SECRET, flow.clientSecret());
            } else {
                session.removeAttribute(SESSION_CLIENT_SECRET);
            }
            if ("smart-private-key-jwt".equals(authMethod)) {
                session.setAttribute(SESSION_TOKEN_ALG, chooseAlg(flow).getName());
            } else {
                session.removeAttribute(SESSION_TOKEN_ALG);
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("authenticated", true);
            result.put("serverUrl", UrlMatchUtil.normalizeUrl(serverUrl));

            // Only an EHR launch routes the SPA into the DTR workspace. A standalone
            // login can also return patient context, which is not a launch.
            if ("smart-ehr-launch".equals(authMethod)) {
                Map<String, Object> smartContext = buildSmartContext(tokens);
                if (!smartContext.isEmpty()) {
                    result.put("smartContext", smartContext);
                }
            }

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
                if (idToken != null && (!isSmartAuthMethod(authMethod) || trustSmartIdToken(flow, idToken))) {
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

                // Tiered OAuth through the local IdP leaves the user identity in
                // the local security context even when the id_token omits it.
                if (userInfo.isEmpty() || !userInfo.containsKey("fhirUser")) {
                    Authentication localAuth = SecurityContextHolder.getContext().getAuthentication();
                    if (localAuth != null && localAuth.getPrincipal() instanceof FhirUserDetails user) {
                        userInfo.put("name", user.getDisplayName());
                        userInfo.put("fhirUser", user.getFhirResourceReference());
                        userInfo.put("fhirUserType", user.getFhirResourceType());
                    }
                }
            }

            session.setAttribute(SESSION_USERINFO, userInfo);
            result.put("userinfo", userInfo);

            logger.info("Token exchange completed for server: {}", serverUrl);
            return ResponseEntity.ok(result);

        } catch (IllegalStateException e) {
            logger.error("Token exchange failed: {}", e.getMessage());
            return ResponseEntity.status(503).body(Map.of(
                "error", "certificate_unavailable",
                "error_description", e.getMessage()));
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
            refreshTokenIfNeeded(session, securityProperties, certificateHolder, smartClientKeyService);

            String accessToken = (String) session.getAttribute(SESSION_ACCESS_TOKEN);
            String tokenServerUrl = (String) session.getAttribute(SESSION_TOKEN_SERVER_URL);

            // No valid token: either anonymous selection (active server
            // chosen via /auth/active-server with no login) or a token that
            // has expired. Preserve the session — SESSION_SERVER_URL is the
            // user's active-server preference and is independent of auth.
            if (accessToken == null || isTokenNearExpiry(session)) {
                return ResponseEntity.ok(Map.of(
                    "authenticated", false,
                    "serverUrl", serverUrl));
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("authenticated", true);
            result.put("access_token", accessToken);
            result.put("serverUrl", serverUrl);
            // Where the token is valid. Differs from `serverUrl` when the
            // user signed in to one server then switched the active SPA
            // server to a public/anonymous one. SPA can use this to label
            // the auth state ("Signed in to X, currently using Y").
            if (tokenServerUrl != null) {
                result.put("tokenServerUrl", tokenServerUrl);
            }

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

    static Map<String, Object> buildSmartContext(Map<String, Object> tokens) {
        Map<String, Object> smartContext = new LinkedHashMap<>();
        if (tokens.get("patient") instanceof String patient && !patient.isBlank()) {
            smartContext.put("patient", patient);
        }
        if (tokens.get("encounter") instanceof String encounter && !encounter.isBlank()) {
            smartContext.put("encounter", encounter);
        }
        List<String> fhirContext = parseFhirContext(tokens.get("fhirContext"));
        if (!fhirContext.isEmpty()) {
            smartContext.put("fhirContext", fhirContext);
        }
        if (tokens.get("appContext") instanceof String appContext && !appContext.isBlank()) {
            smartContext.put("appContext", appContext);
        }
        return smartContext;
    }

    /**
     * Normalizes a SMART fhirContext value to reference strings. Accepts the
     * legacy string-array shape and the current object-array shape, where
     * each object yields its reference, else canonical, else identifier
     * (rendered as system|value, or the identifier's toString otherwise).
     */
    static List<String> parseFhirContext(Object raw) {
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<String> result = new java.util.ArrayList<>();
        for (Object item : list) {
            String value = parseFhirContextEntry(item);
            if (value != null && !value.isBlank()) {
                result.add(value);
            }
        }
        return result;
    }

    private static String parseFhirContextEntry(Object item) {
        if (item instanceof String s) {
            return s;
        }
        if (!(item instanceof Map<?, ?> map)) {
            return null;
        }
        if (map.get("reference") instanceof String reference && !reference.isBlank()) {
            return reference;
        }
        if (map.get("canonical") instanceof String canonical && !canonical.isBlank()) {
            return canonical;
        }
        Object identifier = map.get("identifier");
        return identifier != null ? renderIdentifier(identifier) : null;
    }

    private static String renderIdentifier(Object identifier) {
        if (identifier instanceof Map<?, ?> idMap && idMap.containsKey("system") && idMap.containsKey("value")) {
            return idMap.get("system") + "|" + idMap.get("value");
        }
        return identifier.toString();
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
     * Pairs the token exchange form parameters with the Basic auth header
     * a smart-basic exchange needs, since that credential rides the
     * Authorization header rather than the form body.
     */
    record TokenRequestSpec(Map<String, String> params, String basicAuthHeader) {}

    /**
     * Each method sends only what it requires. udap signs a private_key_jwt
     * assertion and adds udap=1. A public client sends client_id and the PKCE
     * verifier. smart-basic drops client_id from the form and carries the
     * credentials in the Basic header. smart-private-key-jwt signs a fresh
     * assertion with the SMART client key.
     */
    TokenRequestSpec buildTokenRequest(PendingFlow flow, String code) throws Exception {
        String authMethod = flow.authMethod() != null ? flow.authMethod() : "udap";
        return switch (authMethod) {
            case "smart-none", "smart-ehr-launch" -> buildSmartPublicTokenRequest(flow, code);
            case "smart-basic" -> buildSmartBasicTokenRequest(flow, code);
            case "smart-private-key-jwt" -> buildSmartPrivateKeyJwtTokenRequest(flow, code);
            default -> buildUdapTokenRequest(flow, code);
        };
    }

    private TokenRequestSpec buildUdapTokenRequest(PendingFlow flow, String code) throws Exception {
        String tokenEndpoint = flow.tokenEndpoint() != null
            ? flow.tokenEndpoint() : udapClient.getTokenEndpoint();
        String clientId = flow.clientId() != null
            ? flow.clientId() : udapClient.getClientId();

        String clientAssertion = buildClientAssertionFor(tokenEndpoint, clientId);
        Map<String, String> params = new LinkedHashMap<>();
        params.put("grant_type", "authorization_code");
        params.put("code", code);
        params.put("redirect_uri", flow.redirectUri());
        params.put("code_verifier", flow.codeVerifier());
        params.put("client_id", clientId);
        params.put("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
        params.put("client_assertion", clientAssertion);
        params.put("udap", "1");
        return new TokenRequestSpec(params, null);
    }

    private TokenRequestSpec buildSmartPublicTokenRequest(PendingFlow flow, String code) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("grant_type", "authorization_code");
        params.put("code", code);
        params.put("redirect_uri", flow.redirectUri());
        params.put("code_verifier", flow.codeVerifier());
        params.put("client_id", flow.clientId());
        return new TokenRequestSpec(params, null);
    }

    private TokenRequestSpec buildSmartBasicTokenRequest(PendingFlow flow, String code) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("grant_type", "authorization_code");
        params.put("code", code);
        params.put("redirect_uri", flow.redirectUri());
        params.put("code_verifier", flow.codeVerifier());
        String basicAuthHeader = "Basic " + Base64.getEncoder().encodeToString(
            (flow.clientId() + ":" + flow.clientSecret()).getBytes(StandardCharsets.UTF_8));
        return new TokenRequestSpec(params, basicAuthHeader);
    }

    private TokenRequestSpec buildSmartPrivateKeyJwtTokenRequest(PendingFlow flow, String code) throws Exception {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("grant_type", "authorization_code");
        params.put("code", code);
        params.put("redirect_uri", flow.redirectUri());
        params.put("code_verifier", flow.codeVerifier());
        params.put("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
        params.put("client_assertion", smartClientKeyService.buildClientAssertion(
            flow.clientId(), flow.tokenEndpoint(), chooseAlg(flow)));
        return new TokenRequestSpec(params, null);
    }

    /**
     * Picks RS384 unless the server's discovered signing algorithms advertise
     * ES384 only. Falls back to RS384 on any discovery error.
     */
    private JWSAlgorithm chooseAlg(PendingFlow flow) {
        try {
            SmartClientDiscoveryService.SmartConfiguration config = smartDiscovery.discover(flow.serverUrl());
            List<String> algs = config.tokenEndpointAuthSigningAlgs();
            if (algs == null || algs.isEmpty() || algs.contains("RS384")) {
                return JWSAlgorithm.RS384;
            }
            if (algs.contains("ES384")) {
                return JWSAlgorithm.ES384;
            }
            return JWSAlgorithm.RS384;
        } catch (Exception e) {
            logger.warn("SMART discovery failed while choosing client assertion algorithm for {}: {}",
                flow.serverUrl(), e.getMessage());
            return JWSAlgorithm.RS384;
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

            // The JWKS fetch honors the configured TLS policy.
            SSLContext trustAllContext = SecurityUtil.getTrustAllSslContext(securityProperties);
            ResourceRetriever retriever = trustAllContext == null
                ? null
                : new DefaultResourceRetriever(
                    RemoteJWKSet.resolveDefaultHTTPConnectTimeout(),
                    RemoteJWKSet.resolveDefaultHTTPReadTimeout(),
                    RemoteJWKSet.resolveDefaultHTTPSizeLimit(),
                    true,
                    trustAllContext.getSocketFactory());
            JWKSource<SecurityContext> jwkSource =
                new RemoteJWKSet<>(new URL(config.jwksUri()), retriever);
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

    /**
     * Builds a signed client assertion JWT for the specified token endpoint and client.
     */
    static String buildClientAssertionFor(
            CertificateHolder certificateHolder, String tokenEndpoint, String clientId)
            throws Exception {
        if (!certificateHolder.ensureInitialized()) {
            throw new IllegalStateException(
                "Signing certificate is not initialized; the UDAP issuer may be unreachable");
        }
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .issuer(clientId)
            .subject(clientId)
            .audience(tokenEndpoint)
            .expirationTime(Date.from(Instant.now().plusSeconds(300)))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .build();

        // UDAP client assertions are validated using the x5c chain in the header.
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
    public record ActiveServerRequest(String url) {}

    /**
     * Records the active provider FHIR server URL for the session. Lets the
     * SPA push its localStorage selection into the session so subsequent
     * BFF endpoints (CDS hooks, PAS, DTR populate) can resolve the active
     * base without per-request headers.
     *
     * Validates the URL: configured local / trusted-provider hosts pass
     * through; any other host is run through {@link OutboundTargetValidator}
     * to block SSRF (private IPs, link-local, etc.) before being accepted.
     * Without this gate, downstream consumers like PAS make raw HTTP to
     * the session URL with no further check.
     */
    @PostMapping("/active-server")
    public ResponseEntity<Void> setActiveServer(@RequestBody ActiveServerRequest body,
            HttpServletRequest request) {
        if (body == null || body.url() == null || body.url().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        String normalized = UrlMatchUtil.normalizeUrl(body.url());
        if (!isKnownProvider(normalized)) {
            try {
                outboundTargetValidator.validate(normalized);
            } catch (Exception e) {
                logger.warn("Rejecting active-server URL {}: {}", normalized, e.getMessage());
                return ResponseEntity.badRequest().build();
            }
        }
        HttpSession session = request.getSession(true);
        setActiveServer(session, normalized);
        return ResponseEntity.noContent().build();
    }

    private boolean isKnownProvider(String normalized) {
        if (UrlMatchUtil.matchesBaseUrl(normalized, serverProperties.getLocalServerAddress())) {
            return true;
        }
        for (String trusted : serverProperties.getTrustedProviderUrls()) {
            if (UrlMatchUtil.matchesBaseUrl(normalized, trusted)) {
                return true;
            }
        }
        return false;
    }

    public record ActivePayerRequest(String fhirUrl, String clientId) {}

    /**
     * Records the active payer FHIR base URL for the session. Mirrors
     * {@link #setActiveServer} for payers, so the FHIR proxy will trust
     * user-selected payer hosts that aren't in the static
     * {@code app.payer-servers} allowlist (e.g. a public reference payer
     * the user types into the settings dialog).
     *
     * Validates the URL: configured local / known-payer hosts pass through;
     * any other host runs through {@link OutboundTargetValidator} for SSRF
     * protection before acceptance.
     */
    @PostMapping("/active-payer")
    public ResponseEntity<Void> setActivePayer(@RequestBody ActivePayerRequest body,
            HttpServletRequest request) {
        if (body == null || body.fhirUrl() == null || body.fhirUrl().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        String normalized = UrlMatchUtil.normalizeUrl(body.fhirUrl());
        if (!isKnownPayer(normalized)) {
            try {
                outboundTargetValidator.validate(normalized);
            } catch (Exception e) {
                logger.warn("Rejecting active-payer URL {}: {}", normalized, e.getMessage());
                return ResponseEntity.badRequest().build();
            }
        }
        HttpSession session = request.getSession(true);
        session.setAttribute(SESSION_PAYER_FHIR_URL, normalized);
        String clientId = body.clientId();
        if (clientId == null || clientId.isBlank()) {
            session.removeAttribute(SESSION_PAYER_CLIENT_ID);
        } else {
            session.setAttribute(SESSION_PAYER_CLIENT_ID, clientId.trim());
        }
        return ResponseEntity.noContent().build();
    }

    private boolean isKnownPayer(String normalized) {
        return serverProperties.isPayerFhirUrl(normalized);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        SecurityContextHolder.clearContext();
        var session = request.getSession(false);
        if (session != null) {
            session.removeAttribute(SESSION_ACCESS_TOKEN);
            session.removeAttribute(SESSION_ID_TOKEN);
            session.removeAttribute(SESSION_TOKEN_SERVER_URL);
            session.removeAttribute(SESSION_SERVER_URL);
            session.removeAttribute(SESSION_PAYER_FHIR_URL);
            session.removeAttribute(SESSION_PAYER_CLIENT_ID);
            session.removeAttribute(SESSION_USERINFO);
            session.removeAttribute(SESSION_TOKEN_ENDPOINT);
            session.removeAttribute(SESSION_CLIENT_ID);
            session.removeAttribute(SESSION_CLIENT_SECRET);
            session.removeAttribute(SESSION_AUTH_METHOD);
            session.removeAttribute(SESSION_GRANTED_SCOPE);
            session.removeAttribute(SESSION_TOKEN_ALG);
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
