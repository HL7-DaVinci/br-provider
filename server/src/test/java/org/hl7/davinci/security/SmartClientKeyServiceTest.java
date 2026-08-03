package org.hl7.davinci.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class SmartClientKeyServiceTest {

    @Test
    void assertionClaimsMatchSmartSpecForBothAlgs() throws Exception {
        SmartClientKeyService service = new SmartClientKeyService();
        service.init();
        for (JWSAlgorithm alg : List.of(JWSAlgorithm.RS384, JWSAlgorithm.ES384)) {
            String jwt = service.buildClientAssertion(
                "client-abc", "https://payer.example.com/oauth/token", alg);
            SignedJWT parsed = SignedJWT.parse(jwt);
            assertEquals(alg, parsed.getHeader().getAlgorithm());
            assertNotNull(parsed.getHeader().getKeyID());
            JWTClaimsSet claims = parsed.getJWTClaimsSet();
            assertEquals("client-abc", claims.getIssuer());
            assertEquals("client-abc", claims.getSubject());
            assertEquals(List.of("https://payer.example.com/oauth/token"), claims.getAudience());
            assertNotNull(claims.getJWTID());
            assertTrue(claims.getExpirationTime().toInstant().isBefore(Instant.now().plusSeconds(301)));
        }
    }

    @Test
    void configuredKeyFileKeepsTheSameKeysAcrossRestarts(@TempDir Path dir) throws Exception {
        Path keyFile = dir.resolve("smart-client-keys.json");

        SmartClientKeyService first = new SmartClientKeyService();
        ReflectionTestUtils.setField(first, "keyFile", keyFile.toString());
        first.init();

        SmartClientKeyService second = new SmartClientKeyService();
        ReflectionTestUtils.setField(second, "keyFile", keyFile.toString());
        second.init();

        assertEquals(first.publicJwkSet().toString(), second.publicJwkSet().toString());
    }

    @Test
    void rs384AssertionVerifiesAgainstPublishedJwks() throws Exception {
        SmartClientKeyService service = new SmartClientKeyService();
        service.init();
        String jwt = service.buildClientAssertion("c", "https://t/token", JWSAlgorithm.RS384);
        SignedJWT parsed = SignedJWT.parse(jwt);
        RSAKey pub = (RSAKey) service.publicJwkSet().getKeyByKeyId(parsed.getHeader().getKeyID());
        assertTrue(parsed.verify(new RSASSAVerifier(pub.toRSAPublicKey())));
    }
}
