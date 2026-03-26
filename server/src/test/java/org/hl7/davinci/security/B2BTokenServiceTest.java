package org.hl7.davinci.security;

import java.lang.reflect.Method;
import java.util.List;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class B2BTokenServiceTest {

    private static final String TEST_CERT_PATH = "src/test/resources/test-cert.pfx";
    private static final String TEST_CERT_PASSWORD = "testpass";

    @Test
    void clientAssertion_usesRegisteredClientIdForIssuerAndSubject() throws Exception {
        SecurityProperties props = new SecurityProperties();
        props.setEnableAuthentication(true);
        props.setFetchCert(false);
        props.setCertFile(TEST_CERT_PATH);
        props.setCertPassword(TEST_CERT_PASSWORD);
        props.setServerBaseUrl("http://localhost:8080");

        CertificateHolder certificateHolder = new CertificateHolder(props);
        B2BTokenService service = new B2BTokenService(
            certificateHolder,
            props,
            new OutboundTargetValidator(props)
        );

        Method buildClientAssertionJwt = B2BTokenService.class.getDeclaredMethod(
            "buildClientAssertionJwt",
            String.class,
            String.class
        );
        buildClientAssertionJwt.setAccessible(true);

        String clientId = "registered-client";
        String tokenEndpoint = "https://payer.example/token";
        String assertion = (String) buildClientAssertionJwt.invoke(
            service,
            clientId,
            tokenEndpoint
        );

        SignedJWT parsed = SignedJWT.parse(assertion);
        assertEquals(clientId, parsed.getJWTClaimsSet().getIssuer());
        assertEquals(clientId, parsed.getJWTClaimsSet().getSubject());
        assertEquals(List.of(tokenEndpoint), parsed.getJWTClaimsSet().getAudience());
    }
}
