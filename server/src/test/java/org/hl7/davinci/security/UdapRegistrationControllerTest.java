package org.hl7.davinci.security;

import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPrivateKey;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.util.Base64;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;

import static org.junit.jupiter.api.Assertions.*;

class UdapRegistrationControllerTest {

    static RSAPrivateKey privateKey;
    static Base64 certBase64;

    private MutableRegisteredClientRepository repo;
    private UdapRegistrationController controller;

    private static final String REGISTRATION_AUD = "http://localhost:8080/oauth2/register";

    @BeforeAll
    static void loadTestCert() throws Exception {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (FileInputStream fis = new FileInputStream("src/test/resources/test-cert.pfx")) {
            ks.load(fis, "testpass".toCharArray());
        }
        String alias = ks.aliases().nextElement();
        privateKey = (RSAPrivateKey) ks.getKey(alias, "testpass".toCharArray());
        X509Certificate cert = (X509Certificate) ks.getCertificate(alias);
        certBase64 = Base64.encode(cert.getEncoded());
    }

    @BeforeEach
    void setUp() {
        repo = new MutableRegisteredClientRepository();
        SecurityProperties props = new SecurityProperties();
        props.setServerBaseUrl("http://localhost:8080");
        controller = new UdapRegistrationController(repo, props);
    }

    private String buildSoftwareStatement(JWTClaimsSet claims) throws Exception {
        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(List.of(certBase64))
            .build();
        SignedJWT jwt = new SignedJWT(header, claims);
        jwt.sign(new RSASSASigner(privateKey));
        return jwt.serialize();
    }

    private JWTClaimsSet.Builder validClaimsBuilder() {
        return new JWTClaimsSet.Builder()
            .issuer("https://example.com")
            .audience(REGISTRATION_AUD)
            .expirationTime(new Date(System.currentTimeMillis() + 60_000))
            .issueTime(new Date())
            .jwtID(UUID.randomUUID().toString())
            .claim("client_name", "Test Client")
            .claim("grant_types", List.of("authorization_code"))
            .claim("redirect_uris", List.of("https://example.com/callback"))
            .claim("scope", "system/*.read");
    }

    @Test
    void validSoftwareStatement_succeeds() throws Exception {
        String ss = buildSoftwareStatement(validClaimsBuilder().build());
        Map<String, Object> request = Map.of("udap", "1", "software_statement", ss);

        ResponseEntity<Map<String, Object>> response = controller.register(request);

        assertEquals(201, response.getStatusCode().value(),
            "Expected 201 but got " + response.getStatusCode().value() + ": " + response.getBody());
        String clientId = (String) response.getBody().get("client_id");
        assertNotNull(clientId);
        assertEquals("RS256", response.getBody().get("token_endpoint_auth_signing_alg"));

        RegisteredClient registeredClient = repo.findByClientId(clientId);
        assertNotNull(registeredClient);
        assertTrue(registeredClient.getClientAuthenticationMethods().contains(ClientAuthenticationMethod.PRIVATE_KEY_JWT));
        assertEquals("http://localhost:8080/oauth2/udap-jwks?client_id=" + clientId,
            registeredClient.getClientSettings().getJwkSetUrl());
        assertEquals(SignatureAlgorithm.RS256,
            registeredClient.getClientSettings().getTokenEndpointAuthenticationSigningAlgorithm());
    }

    @Test
    void wrongAudience_returns400() throws Exception {
        JWTClaimsSet claims = validClaimsBuilder()
            .audience("https://wrong-server/oauth2/register")
            .build();
        String ss = buildSoftwareStatement(claims);
        Map<String, Object> request = Map.of("udap", "1", "software_statement", ss);

        ResponseEntity<Map<String, Object>> response = controller.register(request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("Invalid audience in software statement", response.getBody().get("error_description"));
    }

    @Test
    void expiredSoftwareStatement_returns400() throws Exception {
        JWTClaimsSet claims = validClaimsBuilder()
            .expirationTime(new Date(System.currentTimeMillis() - 60_000))
            .build();
        String ss = buildSoftwareStatement(claims);
        Map<String, Object> request = Map.of("udap", "1", "software_statement", ss);

        ResponseEntity<Map<String, Object>> response = controller.register(request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("Software statement has expired", response.getBody().get("error_description"));
    }

    @Test
    void missingJti_returns400() throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .issuer("https://example.com")
            .audience(REGISTRATION_AUD)
            .expirationTime(new Date(System.currentTimeMillis() + 60_000))
            .issueTime(new Date())
            .claim("client_name", "Test Client")
            .claim("grant_types", List.of("authorization_code"))
            .claim("scope", "system/*.read")
            .build();
        String ss = buildSoftwareStatement(claims);
        Map<String, Object> request = Map.of("udap", "1", "software_statement", ss);

        ResponseEntity<Map<String, Object>> response = controller.register(request);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("Missing jti in software statement", response.getBody().get("error_description"));
    }

    @Test
    void replayedJti_returns400OnSecondRequest() throws Exception {
        String fixedJti = UUID.randomUUID().toString();

        JWTClaimsSet claims1 = validClaimsBuilder().jwtID(fixedJti).build();
        String ss1 = buildSoftwareStatement(claims1);
        ResponseEntity<Map<String, Object>> response1 = controller.register(
            Map.of("udap", "1", "software_statement", ss1));
        assertTrue(response1.getStatusCode().is2xxSuccessful());

        JWTClaimsSet claims2 = validClaimsBuilder().jwtID(fixedJti).build();
        String ss2 = buildSoftwareStatement(claims2);
        ResponseEntity<Map<String, Object>> response2 = controller.register(
            Map.of("udap", "1", "software_statement", ss2));

        assertEquals(400, response2.getStatusCode().value());
        assertEquals("Replayed software statement", response2.getBody().get("error_description"));
    }

    @Test
    void unsupportedTokenEndpointAuthMethod_returns400() throws Exception {
        JWTClaimsSet claims = validClaimsBuilder()
            .claim("token_endpoint_auth_method", "client_secret_basic")
            .build();
        String ss = buildSoftwareStatement(claims);

        ResponseEntity<Map<String, Object>> response = controller.register(
            Map.of("udap", "1", "software_statement", ss));

        assertEquals(400, response.getStatusCode().value());
        assertEquals("Unsupported token_endpoint_auth_method", response.getBody().get("error_description"));
    }

    @Test
    void unsupportedTokenEndpointAuthSigningAlg_returns400() throws Exception {
        JWTClaimsSet claims = validClaimsBuilder()
            .claim("token_endpoint_auth_signing_alg", "ES256")
            .build();
        String ss = buildSoftwareStatement(claims);

        ResponseEntity<Map<String, Object>> response = controller.register(
            Map.of("udap", "1", "software_statement", ss));

        assertEquals(400, response.getStatusCode().value());
        assertEquals("Unsupported token_endpoint_auth_signing_alg", response.getBody().get("error_description"));
    }
}
