package org.hl7.davinci.security;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import jakarta.servlet.http.HttpSession;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Owns the BFF session token bundle: which FHIR server the SPA is pointed at,
 * the access token held for it, and the metadata needed to refresh that token.
 * Tokens never leave the server; they live in flat HTTP session attributes.
 *
 * Single-server-per-session model: one access token is stored at a time.
 * Switching authenticated servers requires a full logout and re-authentication.
 */
@Component
public class SessionTokenService {

    private static final Logger logger = LoggerFactory.getLogger(SessionTokenService.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    /** Session attribute holding the access token for the authenticated server */
    public static final String SESSION_ACCESS_TOKEN = "bff.access_token";

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
     * signs with the same algorithm chosen at exchange time.
     */
    public static final String SESSION_TOKEN_ALG = "bff.token_alg";

    private final SecurityProperties securityProperties;
    private final CertificateHolder certificateHolder;
    private final SmartClientKeyService smartClientKeyService;

    public SessionTokenService(
            SecurityProperties securityProperties,
            CertificateHolder certificateHolder,
            SmartClientKeyService smartClientKeyService) {
        this.securityProperties = securityProperties;
        this.certificateHolder = certificateHolder;
        this.smartClientKeyService = smartClientKeyService;
    }

    /**
     * Stores an access token for the single authenticated server.
     */
    public void storeServerToken(HttpSession session, String serverUrl, String accessToken) {
        storeServerToken(session, serverUrl, accessToken, null, null, null, null, null);
    }

    /**
     * Stores an access token with expiry and refresh token for the single authenticated server.
     */
    public void storeServerToken(HttpSession session, String serverUrl,
            String accessToken, Long expiresIn, String refreshToken) {
        storeServerToken(session, serverUrl, accessToken, expiresIn, refreshToken, null, null, null);
    }

    /**
     * Stores token metadata required to refresh the active server session,
     * recording the auth method used so a later refresh can select the
     * matching strategy.
     */
    public void storeServerToken(HttpSession session, String serverUrl,
            String accessToken, Long expiresIn, String refreshToken,
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
    public void setActiveServer(HttpSession session, String url) {
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
    public String getTokenForServer(HttpSession session, String targetUrl) {
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
    public boolean isTokenNearExpiry(HttpSession session) {
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
    public void refreshTokenIfNeeded(HttpSession session) {
        if (session == null || !isTokenNearExpiry(session)) return;
        refreshToken(session);
    }

    /**
     * Refreshes the session access token whatever its expiry says, for a caller
     * that saw the target reject the token early. Returns true when a new token
     * is in the session. A failed refresh clears the stored token.
     */
    public boolean refreshToken(HttpSession session) {
        if (session == null) return false;
        String refreshToken = (String) session.getAttribute(SESSION_REFRESH_TOKEN);
        if (refreshToken == null) return false;

        String serverUrl = (String) session.getAttribute(SESSION_TOKEN_SERVER_URL);
        if (serverUrl == null) {
            logger.warn("Missing token server URL for refresh token");
            return false;
        }
        logger.info("Refreshing expired token for server: {}", serverUrl);

        try {
            String tokenEndpoint = (String) session.getAttribute(SESSION_TOKEN_ENDPOINT);
            String clientId = (String) session.getAttribute(SESSION_CLIENT_ID);
            if (tokenEndpoint == null || clientId == null) {
                logger.warn("Missing refresh token metadata for server: {}", serverUrl);
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
                String clientAssertion = buildUdapClientAssertion(tokenEndpoint, clientId);
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
                Map<String, Object> tokens = objectMapper.readValue(
                    tokenResponse.body(), new TypeReference<>() {});
                String newAccessToken = (String) tokens.get("access_token");
                String newRefreshToken = tokens.containsKey("refresh_token")
                    ? (String) tokens.get("refresh_token") : refreshToken;
                Object expiresInObj = tokens.get("expires_in");
                Long expiresIn = expiresInObj instanceof Number n ? n.longValue() : null;

                storeServerToken(session, serverUrl, newAccessToken, expiresIn,
                    newRefreshToken, tokenEndpoint, clientId, authMethod);
                // A token response omits scope when it is unchanged from the request,
                // so an absent scope keeps the previously granted set.
                Object scopeObj = tokens.get("scope");
                if (scopeObj instanceof String s) {
                    session.setAttribute(SESSION_GRANTED_SCOPE, s);
                }
                logger.info("Token refreshed successfully for server: {}", serverUrl);
                return newAccessToken != null;
            } else {
                logger.warn("Token refresh failed: HTTP {} - clearing session", tokenResponse.statusCode());
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
            logger.warn("Token refresh error: {}", e.getMessage());
        }
        return false;
    }

    /**
     * Builds a signed UDAP client assertion JWT for the specified token
     * endpoint and client. UDAP client assertions are validated using the
     * x5c chain in the header.
     */
    public String buildUdapClientAssertion(String tokenEndpoint, String clientId) throws Exception {
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

        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(certificateHolder.getX509CertChain())
            .build();

        SignedJWT signedJwt = new SignedJWT(header, claims);
        signedJwt.sign(new RSASSASigner(certificateHolder.getSigningKey()));
        return signedJwt.serialize();
    }

    static boolean isSmartAuthMethod(String authMethod) {
        return authMethod != null && authMethod.startsWith("smart-");
    }

    static String formEncode(Map<String, String> params) {
        return params.entrySet().stream()
            .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)
                + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
            .collect(Collectors.joining("&"));
    }
}
