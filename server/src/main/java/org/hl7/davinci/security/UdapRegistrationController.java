package org.hl7.davinci.security;

import java.io.ByteArrayInputStream;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.util.Base64;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UdapRegistrationController {

    private static final Logger logger = LoggerFactory.getLogger(UdapRegistrationController.class);

    private final MutableRegisteredClientRepository registeredClientRepository;
    private final String serverRoot;

    // Stores public keys from DCR x5c chains, keyed by client_id
    private final ConcurrentHashMap<String, JWK> clientPublicKeys = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Instant> seenJtis = new ConcurrentHashMap<>();

    public UdapRegistrationController(
            MutableRegisteredClientRepository registeredClientRepository,
            SecurityProperties securityProperties) {
        this.registeredClientRepository = registeredClientRepository;
        this.serverRoot = securityProperties.getServerBaseUrl();
    }

    @PostMapping(value = "/oauth2/register", produces = "application/json")
    public ResponseEntity<Map<String, Object>> register(@RequestBody Map<String, Object> request) {
        try {
            String softwareStatement = (String) request.get("software_statement");
            String udapVersion = (String) request.get("udap");

            if (!"1".equals(udapVersion)) {
                return ResponseEntity.badRequest().body(Map.of("error", "unsupported_udap_version"));
            }
            if (softwareStatement == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_request",
                    "error_description", "software_statement is required"));
            }

            SignedJWT signedJwt = SignedJWT.parse(softwareStatement);
            List<Base64> x5cChain = signedJwt.getHeader().getX509CertChain();
            if (x5cChain == null || x5cChain.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_software_statement",
                    "error_description", "x5c header is required"));
            }

            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            X509Certificate leafCert = (X509Certificate) cf.generateCertificate(
                new ByteArrayInputStream(x5cChain.get(0).decode()));
            RSAKey rsaKey = RSAKey.parse(leafCert);
            if (!signedJwt.verify(new RSASSAVerifier(rsaKey))) {
                return ResponseEntity.status(401).body(Map.of("error", "invalid_software_statement"));
            }

            JWTClaimsSet claims = signedJwt.getJWTClaimsSet();

            // TODO: validate trust chain against community trust anchors

            String expectedAud = serverRoot + "/oauth2/register";
            List<String> audiences = claims.getAudience();
            if (audiences == null || !audiences.contains(expectedAud)) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_software_statement",
                    "error_description", "Invalid audience in software statement"));
            }

            Date expTime = claims.getExpirationTime();
            if (expTime == null || expTime.before(new Date())) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_software_statement",
                    "error_description", "Software statement has expired"));
            }

            Date iatTime = claims.getIssueTime();
            if (iatTime == null || Math.abs(System.currentTimeMillis() - iatTime.getTime()) > 300_000) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_software_statement",
                    "error_description", "Invalid issued-at time in software statement"));
            }

            String jti = claims.getJWTID();
            if (jti == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_software_statement",
                    "error_description", "Missing jti in software statement"));
            }
            Instant now = Instant.now();
            seenJtis.entrySet().removeIf(e -> e.getValue().isBefore(now.minus(5, ChronoUnit.MINUTES)));
            if (seenJtis.putIfAbsent(jti, now) != null) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_software_statement",
                    "error_description", "Replayed software statement"));
            }

            String clientName = claims.getStringClaim("client_name");
            String issuer = claims.getIssuer();
            List<String> grantTypes = claims.getStringListClaim("grant_types");
            String scope = claims.getStringClaim("scope");
            String tokenEndpointAuthMethod = stringClaimOrFirstValue(claims.getClaim("token_endpoint_auth_method"));
            String tokenEndpointAuthSigningAlg = stringClaimOrFirstValue(
                claims.getClaim("token_endpoint_auth_signing_alg"));

            if (clientName == null || issuer == null || grantTypes == null || grantTypes.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_client_metadata",
                    "error_description", "Missing required fields: client_name, iss, grant_types"));
            }
            if (tokenEndpointAuthMethod == null) {
                tokenEndpointAuthMethod = ClientAuthenticationMethod.PRIVATE_KEY_JWT.getValue();
            }
            if (!ClientAuthenticationMethod.PRIVATE_KEY_JWT.getValue().equals(tokenEndpointAuthMethod)) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_client_metadata",
                    "error_description", "Unsupported token_endpoint_auth_method"));
            }
            if (tokenEndpointAuthSigningAlg == null) {
                tokenEndpointAuthSigningAlg = SignatureAlgorithm.RS256.getName();
            }
            if (!SignatureAlgorithm.RS256.getName().equals(tokenEndpointAuthSigningAlg)) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid_client_metadata",
                    "error_description", "Unsupported token_endpoint_auth_signing_alg"));
            }

            // Deterministic client_id from issuer. Required because the FAST RI's
            // UpsertTieredClient overwrites new ClientIds with stale ones on re-registration,
            // causing ExchangeCodeAsync to fail with "client_id not found".
            RegisteredClient existing = registeredClientRepository.findByIssuer(issuer);
            String clientId = (existing != null) ? existing.getClientId()
                : UUID.nameUUIDFromBytes(issuer.getBytes(StandardCharsets.UTF_8)).toString();
            String id = (existing != null) ? existing.getId()
                : UUID.nameUUIDFromBytes(("id:" + issuer).getBytes(StandardCharsets.UTF_8)).toString();
            int httpStatus = (existing != null) ? 200 : 201;

            RegisteredClient.Builder builder = RegisteredClient.withId(id)
                .clientId(clientId)
                .clientName(clientName)
                .clientAuthenticationMethod(ClientAuthenticationMethod.PRIVATE_KEY_JWT);

            for (String gt : grantTypes) {
                builder.authorizationGrantType(new AuthorizationGrantType(gt));
            }

            List<String> redirectUris = claims.getStringListClaim("redirect_uris");
            if (redirectUris != null) {
                builder.redirectUris(uris -> uris.addAll(redirectUris));
            }

            if (scope != null) {
                builder.scopes(scopes -> scopes.addAll(Arrays.asList(scope.split(" "))));
            }

            // Store the client's public key from the x5c chain for client assertion validation.
            // No keyID set: the FAST RI signs JWTs with a kid derived from its certificate
            // thumbprint, not our client_id UUID. Omitting kid lets NimbusDS match by
            // algorithm and key type instead, which is sufficient for single-key clients.
            RSAKey clientJwk = new RSAKey.Builder(rsaKey.toRSAPublicKey())
                .keyUse(KeyUse.SIGNATURE)
                .algorithm(JWSAlgorithm.RS256)
                .build();
            clientPublicKeys.put(clientId, clientJwk);

            // UDAP clients use x5c for key distribution, not jwks_uri.
            // Serve the client's public key via our own JWKS endpoint.
            String jwksUrl = claims.getStringClaim("jwks_uri");
            if (jwksUrl == null) {
                jwksUrl = serverRoot + "/oauth2/udap-jwks?client_id=" + clientId;
            }

            builder.clientSettings(ClientSettings.builder()
                .requireProofKey(false)
                .jwkSetUrl(jwksUrl)
                .tokenEndpointAuthenticationSigningAlgorithm(SignatureAlgorithm.RS256)
                .build());

            RegisteredClient registeredClient = builder.build();
            registeredClientRepository.saveWithIssuer(registeredClient, issuer);
            logger.info("Registered UDAP client: {} (iss: {}, status: {}, jwks_url: {}, token_endpoint_auth_signing_alg: {})",
                clientId, issuer, httpStatus, jwksUrl, tokenEndpointAuthSigningAlg);

            return ResponseEntity.status(httpStatus).body(Map.of(
                "client_id", clientId,
                "client_name", clientName,
                "grant_types", grantTypes,
                "token_endpoint_auth_method", "private_key_jwt",
                "token_endpoint_auth_signing_alg", tokenEndpointAuthSigningAlg,
                "scope", scope != null ? scope : "",
                "software_statement", softwareStatement
            ));
        } catch (Exception e) {
            logger.error("UDAP registration failed", e);
            return ResponseEntity.badRequest().body(Map.of("error", "invalid_software_statement",
                "error_description", e.getMessage()));
        }
    }

    /**
     * Serves JWKS for UDAP-registered clients.
     * Spring Auth Server fetches this to validate private_key_jwt client assertions.
     */
    @GetMapping(value = "/oauth2/udap-jwks", produces = "application/json")
    public ResponseEntity<String> clientJwks(@RequestParam("client_id") String clientId) {
        JWK jwk = clientPublicKeys.get(clientId);
        if (jwk == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(new JWKSet(jwk).toString());
    }

    private static String stringClaimOrFirstValue(Object claimValue) {
        if (claimValue instanceof String claimString && !claimString.isBlank()) {
            return claimString;
        }
        if (claimValue instanceof List<?> claimList) {
            for (Object value : claimList) {
                if (value instanceof String claimString && !claimString.isBlank()) {
                    return claimString;
                }
            }
        }
        return null;
    }
}
