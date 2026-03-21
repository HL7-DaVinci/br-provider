package org.hl7.davinci.security;

import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import ca.uhn.fhir.interceptor.api.Hook;
import ca.uhn.fhir.interceptor.api.Pointcut;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.hl7.davinci.common.BaseInterceptor;
import org.springframework.stereotype.Component;

/**
 * Resource server UDAP discovery at /fhir/.well-known/udap.
 * These endpoints point to the configured UDAP security server.
 */
@Component
public class UdapDiscoveryInterceptor extends BaseInterceptor {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final SecurityProperties securityProperties;
    private final CertificateHolder certificateHolder;
    private final String baseUrl;

    public UdapDiscoveryInterceptor(
            SecurityProperties securityProperties,
            CertificateHolder certificateHolder) {
        this.securityProperties = securityProperties;
        this.certificateHolder = certificateHolder;
        this.baseUrl = securityProperties.getServerBaseUrl();
    }

    @Hook(Pointcut.SERVER_INCOMING_REQUEST_PRE_HANDLER_SELECTED)
    public boolean handleUdapDiscovery(HttpServletRequest request, HttpServletResponse response) throws Exception {
        if (!request.getRequestURI().endsWith("/.well-known/udap")) {
            return true;
        }

        if (!certificateHolder.isInitialized()) {
            response.setStatus(503);
            response.setContentType("application/json");
            objectMapper.writeValue(response.getOutputStream(), Map.of("error", "Certificate not initialized"));
            return false;
        }

        String securityServerUrl = securityProperties.getIssuer().replaceAll("/+$", "");

        JWTClaimsSet metadataClaims = new JWTClaimsSet.Builder()
            .issuer(baseUrl)
            .subject(baseUrl)
            .expirationTime(Date.from(Instant.now().plusSeconds(86400)))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .claim("authorization_endpoint", securityServerUrl + "/connect/authorize")
            .claim("token_endpoint", securityServerUrl + "/connect/token")
            .claim("registration_endpoint", securityServerUrl + "/connect/register")
            .build();

        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(certificateHolder.getX509CertChain())
            .keyID(certificateHolder.getSigningKey().getKeyID())
            .build();

        SignedJWT signedMetadata = new SignedJWT(header, metadataClaims);
        signedMetadata.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("udap_versions_supported", List.of("1"));
        metadata.put("udap_profiles_supported", List.of("udap_dcr", "udap_authn", "udap_authz", "udap_to"));
        metadata.put("udap_authorization_extensions_supported", List.of("hl7-b2b"));
        metadata.put("udap_authorization_extensions_required", List.of());
        metadata.put("udap_certifications_supported", List.of());
        metadata.put("grant_types_supported", List.of("authorization_code", "client_credentials"));
        metadata.put("scopes_supported", List.of("openid", "fhirUser", "udap",
            "patient/*.read", "user/*.read", "system/*.read"));
        metadata.put("authorization_endpoint", securityServerUrl + "/connect/authorize");
        metadata.put("token_endpoint", securityServerUrl + "/connect/token");
        metadata.put("token_endpoint_auth_methods_supported", List.of("private_key_jwt"));
        metadata.put("token_endpoint_auth_signing_alg_values_supported", List.of("RS256", "RS384", "ES256", "ES384"));
        metadata.put("registration_endpoint", securityServerUrl + "/connect/register");
        metadata.put("registration_endpoint_jwt_signing_alg_values_supported", List.of("RS256", "RS384", "ES256", "ES384"));
        metadata.put("issuer", securityServerUrl);
        metadata.put("signed_metadata", signedMetadata.serialize());

        response.setStatus(200);
        response.setContentType("application/json");
        objectMapper.writeValue(response.getOutputStream(), metadata);
        return false;
    }
}
