package org.hl7.davinci.security;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Date;
import java.util.UUID;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TokenValidatorTest {

    static final String FAST_RI_ISSUER = "https://localhost:5001";

    static RSAKey rsaKey;
    static RSASSASigner signer;
    TokenValidator validator;

    @BeforeAll
    static void generateKey() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair kp = kpg.generateKeyPair();
        rsaKey = new RSAKey.Builder((RSAPublicKey) kp.getPublic())
            .privateKey((RSAPrivateKey) kp.getPrivate())
            .keyUse(KeyUse.SIGNATURE)
            .algorithm(JWSAlgorithm.RS256)
            .keyID("test-key")
            .build();
        signer = new RSASSASigner(rsaKey);
    }

    @BeforeEach
    void setUp() {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setIssuer(FAST_RI_ISSUER);

        ImmutableJWKSet<SecurityContext> jwkSource = new ImmutableJWKSet<>(new JWKSet(rsaKey.toPublicJWK()));
        validator = new TokenValidator(props, jwkSource);
    }

    private String signToken(JWTClaimsSet claims) throws Exception {
        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test-key").build();
        SignedJWT jwt = new SignedJWT(header, claims);
        jwt.sign(signer);
        return jwt.serialize();
    }

    @Test
    void validToken_succeeds() throws Exception {
        String token = signToken(new JWTClaimsSet.Builder()
            .issuer(FAST_RI_ISSUER)
            .expirationTime(new Date(System.currentTimeMillis() + 60000))
            .jwtID(UUID.randomUUID().toString())
            .claim("fhirUser", "Practitioner/123")
            .claim("name", "Dr. Test")
            .build());

        JWTClaimsSet claims = validator.validate(token);
        assertEquals(FAST_RI_ISSUER, claims.getIssuer());
        assertEquals("Practitioner/123", claims.getStringClaim("fhirUser"));
        assertEquals("Dr. Test", claims.getStringClaim("name"));
    }

    @Test
    void expiredToken_throws() {
        assertThrows(Exception.class, () -> {
            String token = signToken(new JWTClaimsSet.Builder()
                .issuer(FAST_RI_ISSUER)
                .expirationTime(new Date(System.currentTimeMillis() - 60000))
                .build());
            validator.validate(token);
        });
    }

    @Test
    void wrongIssuer_throws() {
        assertThrows(Exception.class, () -> {
            String token = signToken(new JWTClaimsSet.Builder()
                .issuer("https://evil.example.com")
                .expirationTime(new Date(System.currentTimeMillis() + 60000))
                .build());
            validator.validate(token);
        });
    }

    @Test
    void invalidSignature_throws() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair otherKp = kpg.generateKeyPair();
        RSAKey otherKey = new RSAKey.Builder((RSAPublicKey) otherKp.getPublic())
            .privateKey((RSAPrivateKey) otherKp.getPrivate())
            .algorithm(JWSAlgorithm.RS256).keyID("other-key").build();

        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("other-key").build();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .issuer(FAST_RI_ISSUER)
            .expirationTime(new Date(System.currentTimeMillis() + 60000))
            .build();
        SignedJWT jwt = new SignedJWT(header, claims);
        jwt.sign(new RSASSASigner(otherKey));

        assertThrows(Exception.class, () -> validator.validate(jwt.serialize()));
    }

    @Test
    void authDisabled_throws() {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(false);
        ImmutableJWKSet<SecurityContext> jwkSource = new ImmutableJWKSet<>(new JWKSet(rsaKey.toPublicJWK()));
        TokenValidator disabledValidator = new TokenValidator(props, jwkSource);

        assertThrows(Exception.class, () -> {
            String token = signToken(new JWTClaimsSet.Builder()
                .issuer(FAST_RI_ISSUER)
                .expirationTime(new Date(System.currentTimeMillis() + 60000))
                .build());
            disabledValidator.validate(token);
        });
    }
}
