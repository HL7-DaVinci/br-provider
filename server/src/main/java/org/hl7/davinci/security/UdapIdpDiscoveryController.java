package org.hl7.davinci.security;

import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * IdP UDAP discovery at /.well-known/udap (server root).
 * Used by the UDAP server during Tiered OAuth to discover the provider's
 * IdP capabilities and register as a client. All endpoints point to the provider's
 * own authorization server (Spring Authorization Server).
 */
@RestController
public class UdapIdpDiscoveryController {

    private final CertificateHolder certificateHolder;
    private final String serverRoot;

    public UdapIdpDiscoveryController(
            CertificateHolder certificateHolder,
            SecurityProperties securityProperties) {
        this.certificateHolder = certificateHolder;
        this.serverRoot = securityProperties.getServerBaseUrl();
    }

    @GetMapping(value = "/.well-known/udap", produces = "application/json")
    public ResponseEntity<Map<String, Object>> udapDiscovery(
            @RequestParam(value = "community", required = false) String community) throws Exception {

        if (!certificateHolder.isInitialized()) {
            return ResponseEntity.status(503).body(Map.of("error", "Certificate not initialized"));
        }

        JWTClaimsSet metadataClaims = new JWTClaimsSet.Builder()
            .issuer(serverRoot)
            .subject(serverRoot)
            .expirationTime(Date.from(Instant.now().plusSeconds(86400)))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .claim("authorization_endpoint", serverRoot + "/oauth2/authorize")
            .claim("token_endpoint", serverRoot + "/oauth2/token")
            .claim("registration_endpoint", serverRoot + "/oauth2/register")
            .build();

        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(certificateHolder.getX509CertChain())
            .keyID(certificateHolder.getSigningKey().getKeyID())
            .build();

        SignedJWT signedMetadata = new SignedJWT(header, metadataClaims);
        signedMetadata.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("udap_versions_supported", List.of("1"));
        metadata.put("udap_profiles_supported", List.of("udap_dcr", "udap_authn", "udap_to"));
        metadata.put("udap_authorization_extensions_supported", List.of());
        metadata.put("udap_certifications_supported", List.of());
        metadata.put("grant_types_supported", List.of("authorization_code"));
        metadata.put("scopes_supported", List.of("openid", "udap", "fhirUser", "profile", "email"));
        metadata.put("authorization_endpoint", serverRoot + "/oauth2/authorize");
        metadata.put("token_endpoint", serverRoot + "/oauth2/token");
        metadata.put("token_endpoint_auth_methods_supported", List.of("private_key_jwt"));
        metadata.put("token_endpoint_auth_signing_alg_values_supported", List.of("RS256"));
        metadata.put("registration_endpoint", serverRoot + "/oauth2/register");
        metadata.put("registration_endpoint_jwt_signing_alg_values_supported", List.of("RS256"));
        metadata.put("signed_metadata", signedMetadata.serialize());

        return ResponseEntity.ok(metadata);
    }
}
