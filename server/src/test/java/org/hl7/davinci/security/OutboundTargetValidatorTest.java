package org.hl7.davinci.security;

import java.net.URI;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class OutboundTargetValidatorTest {

    private OutboundTargetValidator validator;

    @BeforeEach
    void setUp() {
        validator = new OutboundTargetValidator(new SecurityProperties());
    }

    @Test
    void validate_allowsConfiguredLocalhostNames() {
        assertEquals(URI.create("http://localhost:8080/fhir"),
            validator.validate("http://localhost:8080/fhir"));
        assertEquals(URI.create("http://host.docker.internal:8082/fhir"),
            validator.validate("http://host.docker.internal:8082/fhir"));
        assertEquals(URI.create("http://[::1]:8081/fhir"),
            validator.validate("http://[::1]:8081/fhir"));
    }

    @Test
    void validate_allowsPublicLiteralAddress() {
        URI uri = validator.validate("https://1.1.1.1/fhir");

        assertEquals(URI.create("https://1.1.1.1/fhir"), uri);
    }

    @Test
    void validate_rejectsPrivateAndLinkLocalAddresses() {
        IllegalArgumentException privateAddress = assertThrows(IllegalArgumentException.class,
            () -> validator.validate("http://192.168.1.10/fhir"));
        IllegalArgumentException linkLocal = assertThrows(IllegalArgumentException.class,
            () -> validator.validate("http://169.254.169.254/fhir"));

        assertEquals("Target host resolves to a local or non-public address", privateAddress.getMessage());
        assertEquals("Target host resolves to a local or non-public address", linkLocal.getMessage());
    }

    @Test
    void validate_rejectsInvalidSchemeAndUserInfo() {
        IllegalArgumentException badScheme = assertThrows(IllegalArgumentException.class,
            () -> validator.validate("file:///etc/passwd"));
        IllegalArgumentException userInfo = assertThrows(IllegalArgumentException.class,
            () -> validator.validate("https://user:pass@example.com/fhir"));

        assertEquals("Target URL must use http or https", badScheme.getMessage());
        assertEquals("Target URL must not include user info", userInfo.getMessage());
    }
}
