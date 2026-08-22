package org.hl7.davinci.security;

import java.io.FileInputStream;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.util.Base64;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.*;

class UdapClientAssertionKeyFilterTest {

    private static final String ISSUER = "https://localhost:5055";

    static RSAPrivateKey privateKey;
    static Base64 certBase64;

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

    private String assertionFor(String clientId, String iss, PrivateKey signingKey) throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .subject(clientId)
            .issuer(iss)
            .expirationTime(new Date(System.currentTimeMillis() + 300_000))
            .build();
        JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
            .x509CertChain(List.of(certBase64))
            .build();
        SignedJWT jwt = new SignedJWT(header, claims);
        jwt.sign(new RSASSASigner(signingKey));
        return jwt.serialize();
    }

    private void runFilter(UdapClientKeyStore keyStore, String assertion) throws Exception {
        UdapClientAssertionKeyFilter filter = new UdapClientAssertionKeyFilter(keyStore);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/oauth2/token");
        request.addParameter("client_assertion", assertion);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertNotNull(chain.getRequest(), "filter chain must always continue");
    }

    @Test
    void validAssertion_storesKeyAndContinuesChain() throws Exception {
        String clientId = TieredClientIds.encode(ISSUER);
        UdapClientKeyStore keyStore = new UdapClientKeyStore();

        runFilter(keyStore, assertionFor(clientId, clientId, privateKey));

        assertNotNull(keyStore.get(clientId));
    }

    @Test
    void signatureFromDifferentKeyThanX5cLeaf_storesNothing() throws Exception {
        String clientId = TieredClientIds.encode(ISSUER);
        UdapClientKeyStore keyStore = new UdapClientKeyStore();

        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("RSA");
        keyGen.initialize(2048);
        PrivateKey otherKey = keyGen.generateKeyPair().getPrivate();

        runFilter(keyStore, assertionFor(clientId, clientId, otherKey));

        assertNull(keyStore.get(clientId));
    }

    @Test
    void subjectThatIsNotATieredClientId_storesNothing() throws Exception {
        String clientId = UUID.randomUUID().toString();
        UdapClientKeyStore keyStore = new UdapClientKeyStore();

        runFilter(keyStore, assertionFor(clientId, clientId, privateKey));

        assertNull(keyStore.get(clientId));
    }

    @Test
    void keyAlreadyPresent_isNotOverwritten() throws Exception {
        String clientId = TieredClientIds.encode(ISSUER);
        UdapClientKeyStore keyStore = new UdapClientKeyStore();

        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("RSA");
        keyGen.initialize(2048);
        RSAKey existing = new RSAKey.Builder((RSAPublicKey) keyGen.generateKeyPair().getPublic()).build();
        keyStore.put(clientId, existing);

        runFilter(keyStore, assertionFor(clientId, clientId, privateKey));

        assertEquals(existing, keyStore.get(clientId));
    }
}
