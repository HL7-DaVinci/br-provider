package org.hl7.davinci.security;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Shared UDAP discovery and Dynamic Client Registration mechanics used by
 * {@link UdapClientRegistration} (authorization_code) and
 * {@link B2BTokenService} (client_credentials). Callers supply the
 * grant-specific software statement claims; this class owns the metadata
 * fetch, endpoint SSRF validation, statement signing, and the DCR POST.
 */
class UdapDcrClient {

    private static final Logger logger = LoggerFactory.getLogger(UdapDcrClient.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final SecurityProperties securityProperties;
    private final CertificateHolder certificateHolder;
    private final OutboundTargetValidator outboundTargetValidator;

    UdapDcrClient(
            SecurityProperties securityProperties,
            CertificateHolder certificateHolder,
            OutboundTargetValidator outboundTargetValidator) {
        this.securityProperties = securityProperties;
        this.certificateHolder = certificateHolder;
        this.outboundTargetValidator = outboundTargetValidator;
    }

    /**
     * UDAP metadata with every advertised endpoint already validated against
     * the SSRF gate. Endpoints the server did not advertise are null; callers
     * enforce which ones their flow requires. The issuer falls back to the
     * origin of the authorization endpoint (or token endpoint) when the
     * metadata omits it.
     */
    record UdapMetadata(
        String authorizeEndpoint,
        String tokenEndpoint,
        String registrationEndpoint,
        String userinfoEndpoint,
        String issuer,
        Map<String, Object> raw
    ) {}

    UdapMetadata discoverMetadata(String udapDiscoveryUrl) throws Exception {
        outboundTargetValidator.validate(udapDiscoveryUrl);

        logger.info("Discovering UDAP endpoints from: {}", udapDiscoveryUrl);
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(udapDiscoveryUrl))
            .GET()
            .timeout(Duration.ofSeconds(10))
            .build();

        HttpResponse<String> response = SecurityUtil.getHttpClient(securityProperties)
            .send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new RuntimeException("UDAP discovery failed for " + udapDiscoveryUrl
                + ": HTTP " + response.statusCode());
        }

        Map<String, Object> metadata = objectMapper.readValue(
            response.body(), new TypeReference<>() {});

        String authorizeEp = (String) metadata.get("authorization_endpoint");
        String tokenEp = (String) metadata.get("token_endpoint");
        String registrationEp = (String) metadata.get("registration_endpoint");
        String userinfoEp = (String) metadata.get("userinfo_endpoint");
        for (String endpoint : new String[]{authorizeEp, tokenEp, registrationEp, userinfoEp}) {
            if (endpoint != null) {
                outboundTargetValidator.validate(endpoint);
            }
        }

        String issuer = (String) metadata.get("issuer");
        if (issuer == null) {
            String origin = authorizeEp != null ? authorizeEp : tokenEp;
            if (origin != null) {
                URI originUri = URI.create(origin);
                issuer = originUri.getScheme() + "://" + originUri.getAuthority();
                logger.warn("UDAP metadata missing issuer, derived from advertised endpoint: {}", issuer);
            }
        }

        return new UdapMetadata(authorizeEp, tokenEp, registrationEp, userinfoEp, issuer, metadata);
    }

    /**
     * Software statement claims every UDAP DCR shares. Some authorization
     * servers normalize the client URL with a trailing slash, so one is
     * appended before it becomes iss/sub. Callers add the grant-specific
     * claims (client_name, grant_types, redirect_uris, scope).
     */
    JWTClaimsSet.Builder softwareStatementBase(String clientBaseUrl, String registrationEndpoint) {
        String baseUrl = clientBaseUrl.endsWith("/") ? clientBaseUrl : clientBaseUrl + "/";
        return new JWTClaimsSet.Builder()
            .issuer(baseUrl)
            .subject(baseUrl)
            .audience(registrationEndpoint)
            .expirationTime(Date.from(Instant.now().plusSeconds(300)))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .claim("contacts", List.of("mailto:admin@localhost"))
            .claim("logo_uri", "https://build.fhir.org/icon-fhir-16.png")
            .claim("token_endpoint_auth_method", List.of("private_key_jwt"));
    }

    /**
     * Signs the software statement with the UDAP certificate (alg and x5c
     * only in the header, per the UDAP IG) and POSTs the registration.
     * Returns the client_id the authorization server assigned.
     */
    String performDcr(String registrationEndpoint, JWTClaimsSet softwareStatementClaims) throws Exception {
        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(certificateHolder.getX509CertChain())
            .build();
        SignedJWT signedStatement = new SignedJWT(header, softwareStatementClaims);
        signedStatement.sign(new RSASSASigner(certificateHolder.getSigningKey()));

        // Certifications are required by the UDAP IG, even if empty.
        Map<String, Object> registrationBody = Map.of(
            "software_statement", signedStatement.serialize(),
            "certifications", List.of(),
            "udap", "1"
        );

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(registrationEndpoint))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(registrationBody)))
            .timeout(Duration.ofSeconds(15))
            .build();

        HttpResponse<String> response = SecurityUtil.getHttpClient(securityProperties)
            .send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200 && response.statusCode() != 201) {
            throw new RuntimeException("UDAP registration failed: HTTP " + response.statusCode()
                + " " + response.body());
        }

        Map<String, Object> result = objectMapper.readValue(
            response.body(), new TypeReference<>() {});
        String clientId = (String) result.get("client_id");
        if (clientId == null) {
            throw new RuntimeException("UDAP registration response missing client_id");
        }
        return clientId;
    }
}
