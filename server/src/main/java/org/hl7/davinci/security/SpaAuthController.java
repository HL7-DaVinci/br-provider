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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * SPA authentication controller for OAuth2 authorization code flow with PKCE.
 * Provides endpoints for login initiation, token exchange (stored server-side
 * in the HTTP session), session status, and logout.
 * Private keys never leave the server; tokens are held in the server session.
 */
@RestController
@RequestMapping("/auth")
public class SpaAuthController {

    private static final Logger logger = LoggerFactory.getLogger(SpaAuthController.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final SecureRandom secureRandom = new SecureRandom();
    private static final long PENDING_FLOW_TTL_SECONDS = 300;

    public static final String SESSION_ACCESS_TOKEN = "bff.access_token";
    public static final String SESSION_ID_TOKEN = "bff.id_token";

    private final UdapClientRegistration udapClient;
    private final CertificateHolder certificateHolder;
    private final SecurityProperties securityProperties;
    private final ConcurrentHashMap<String, PendingFlow> pendingFlows = new ConcurrentHashMap<>();

    record PendingFlow(String codeVerifier, String redirectUri, Instant createdAt) {}

    public SpaAuthController(
            UdapClientRegistration udapClient,
            CertificateHolder certificateHolder,
            SecurityProperties securityProperties) {
        this.udapClient = udapClient;
        this.certificateHolder = certificateHolder;
        this.securityProperties = securityProperties;
    }

    /**
     * Initiates the OAuth2 authorization code flow.
     * Generates PKCE verifier/challenge and state, stores in memory, redirects to FAST RI.
     */
    @GetMapping("/login")
    public ResponseEntity<Void> login() throws Exception {
        udapClient.ensureRegistered();

        String codeVerifier = generateCodeVerifier();
        String codeChallenge = generateCodeChallenge(codeVerifier);
        String state = UUID.randomUUID().toString();
        String redirectUri = udapClient.getRedirectUri();

        pendingFlows.put(state, new PendingFlow(codeVerifier, redirectUri, Instant.now()));

        String authorizeUrl = udapClient.getAuthorizeEndpoint()
            + "?response_type=code"
            + "&client_id=" + udapClient.getClientId()
            + "&redirect_uri=" + URI.create(redirectUri).toASCIIString()
            + "&scope=" + securityProperties.getScope().replace(" ", "+")
            + "&code_challenge=" + codeChallenge
            + "&code_challenge_method=S256"
            + "&state=" + state
            + "&idp=" + securityProperties.getServerBaseUrl()
            + "&prompt=login";

        logger.debug("SPA login redirect to: {}", authorizeUrl);
        return ResponseEntity.status(302).location(URI.create(authorizeUrl)).build();
    }

    /**
     * Exchanges an authorization code for tokens using private_key_jwt.
     * Tokens are stored in the server-side HTTP session (BFF pattern).
     * Only user identity info is returned to the SPA.
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
            Map<String, String> tokenParams = buildTokenParams(flow, code);

            HttpClient httpClient = SecurityUtil.getHttpClient(securityProperties);
            HttpRequest tokenRequest = HttpRequest.newBuilder()
                .uri(URI.create(udapClient.getTokenEndpoint()))
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

            // Store tokens in server-side session
            var session = request.getSession(true);
            session.setAttribute(SESSION_ACCESS_TOKEN, tokens.get("access_token"));
            if (tokens.containsKey("id_token")) {
                session.setAttribute(SESSION_ID_TOKEN, tokens.get("id_token"));
            }

            // Return only user identity info to the SPA (no tokens)
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("authenticated", true);

            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getPrincipal() instanceof FhirUserDetails user) {
                Map<String, String> userInfo = new LinkedHashMap<>();
                userInfo.put("name", user.getDisplayName());
                userInfo.put("fhirUser", user.getFhirResourceReference());
                userInfo.put("fhirUserType", user.getFhirResourceType());
                result.put("userinfo", userInfo);
            }

            logger.info("SPA token exchange completed successfully");
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
        if (session == null || session.getAttribute(SESSION_ACCESS_TOKEN) == null) {
            return ResponseEntity.ok(Map.of("authenticated", false));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("authenticated", true);
        result.put("access_token", session.getAttribute(SESSION_ACCESS_TOKEN));

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof FhirUserDetails user) {
            result.put("userinfo", Map.of(
                "name", user.getDisplayName(),
                "fhirUser", user.getFhirResourceReference(),
                "fhirUserType", user.getFhirResourceType()));
        }
        return ResponseEntity.ok(result);
    }

    private void pruneExpiredFlows() {
        Instant cutoff = Instant.now().minusSeconds(PENDING_FLOW_TTL_SECONDS);
        pendingFlows.entrySet().removeIf(entry -> entry.getValue().createdAt().isBefore(cutoff));
    }

    Map<String, String> buildTokenParams(PendingFlow flow, String code) throws Exception {
        String clientAssertion = buildClientAssertion(udapClient.getTokenEndpoint());
        Map<String, String> tokenParams = new LinkedHashMap<>();
        tokenParams.put("grant_type", "authorization_code");
        tokenParams.put("code", code);
        tokenParams.put("redirect_uri", flow.redirectUri());
        tokenParams.put("code_verifier", flow.codeVerifier());
        tokenParams.put("client_id", udapClient.getClientId());
        tokenParams.put("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
        tokenParams.put("client_assertion", clientAssertion);
        tokenParams.put("udap", "1");
        return tokenParams;
    }

    String buildClientAssertion(String tokenEndpoint) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .issuer(udapClient.getClientId())
            .subject(udapClient.getClientId())
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
     * Explicitly removes session attributes before invalidation to prevent
     * Spring Security's filter chain from re-saving the security context.
     */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        SecurityContextHolder.clearContext();
        var session = request.getSession(false);
        if (session != null) {
            session.removeAttribute(SESSION_ACCESS_TOKEN);
            session.removeAttribute(SESSION_ID_TOKEN);
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
