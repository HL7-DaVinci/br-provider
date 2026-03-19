package org.hl7.davinci.security;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import static org.junit.jupiter.api.Assertions.*;

class FhirUserDetailsTest {

    @Test
    void practitionerResourceType() {
        FhirUserDetails user = new FhirUserDetails(
            "pra1234", "{noop}test", "Practitioner/pra1234", "Dr. Jane Doe",
            List.of(new SimpleGrantedAuthority("ROLE_PRACTITIONER")));

        assertEquals("Practitioner/pra1234", user.getFhirResourceReference());
        assertEquals("Practitioner", user.getFhirResourceType());
        assertEquals("Dr. Jane Doe", user.getDisplayName());
        assertEquals("pra1234", user.getUsername());
    }

    @Test
    void patientResourceType() {
        FhirUserDetails user = new FhirUserDetails(
            "pat015", "{noop}test", "Patient/pat015", "William Oster",
            List.of(new SimpleGrantedAuthority("ROLE_PATIENT")));

        assertEquals("Patient", user.getFhirResourceType());
    }

    @Test
    void noSlash_returnsUnknown() {
        FhirUserDetails user = new FhirUserDetails(
            "bad", "{noop}test", "NoSlash", "Bad",
            List.of(new SimpleGrantedAuthority("ROLE_PATIENT")));

        assertEquals("Unknown", user.getFhirResourceType());
    }

    @Test
    void nullReference_returnsUnknown() {
        FhirUserDetails user = new FhirUserDetails(
            "null", "{noop}test", null, "Null",
            List.of(new SimpleGrantedAuthority("ROLE_PATIENT")));

        assertEquals("Unknown", user.getFhirResourceType());
    }
}
