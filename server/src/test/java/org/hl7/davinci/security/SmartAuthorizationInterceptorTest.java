package org.hl7.davinci.security;

import java.util.Date;
import java.util.List;
import com.nimbusds.jwt.JWTClaimsSet;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit-level coverage of the scope-parsing helpers used by
 * {@link SmartAuthorizationInterceptor}. End-to-end rule enforcement is
 * exercised via integration tests that go through HAPI's interceptor chain.
 */
class SmartAuthorizationInterceptorTest {

    @Test
    void parseScopes_handlesSpaceSeparatedString() {
        var scopes = SmartAuthorizationInterceptor.parseScopes("openid user/Patient.rs patient/*.read");
        assertTrue(scopes.contains("openid"));
        assertTrue(scopes.contains("user/Patient.rs"));
        assertTrue(scopes.contains("patient/*.read"));
        assertEquals(3, scopes.size());
    }

    @Test
    void parseScopes_handlesListClaim() {
        var scopes = SmartAuthorizationInterceptor.parseScopes(List.of("openid", "user/*.cruds"));
        assertEquals(2, scopes.size());
        assertTrue(scopes.contains("user/*.cruds"));
    }

    @Test
    void resolvePatientContext_prefersPatientClaim() {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("patient", "patient-1")
            .claim("fhirUser", "Patient/patient-2")
            .expirationTime(new Date(System.currentTimeMillis() + 60_000))
            .build();
        assertEquals("patient-1", SmartAuthorizationInterceptor.resolvePatientContext(claims));
    }

    @Test
    void resolvePatientContext_fallsBackToFhirUserPatient() {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("fhirUser", "Patient/patient-2")
            .expirationTime(new Date(System.currentTimeMillis() + 60_000))
            .build();
        assertEquals("patient-2", SmartAuthorizationInterceptor.resolvePatientContext(claims));
    }

    @Test
    void resolvePatientContext_rejectsPractitionerFhirUser() {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("fhirUser", "Practitioner/p1")
            .expirationTime(new Date(System.currentTimeMillis() + 60_000))
            .build();
        assertNull(SmartAuthorizationInterceptor.resolvePatientContext(claims));
    }

    @Test
    void resolvePatientContext_rejectsTypesEndingInPatientButNotPatient() {
        // A type whose suffix happens to spell "Patient" must not be treated
        // as the Patient resource type. Defends against a malicious or
        // misconfigured IdP injecting "NotAPatient/<id>" or similar.
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("fhirUser", "NotAPatient/123")
            .expirationTime(new Date(System.currentTimeMillis() + 60_000))
            .build();
        assertNull(SmartAuthorizationInterceptor.resolvePatientContext(claims));
    }

    @Test
    void resolvePatientContext_acceptsAbsoluteFhirUserUrlEndingInPatient() {
        // The IdP may emit fhirUser as a fully-qualified resource URL.
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("fhirUser", "https://server.example/fhir/Patient/abc-123")
            .expirationTime(new Date(System.currentTimeMillis() + 60_000))
            .build();
        assertEquals("abc-123", SmartAuthorizationInterceptor.resolvePatientContext(claims));
    }

    @Test
    void resolvePatientContext_rejectsAbsoluteUrlWithMaliciousPatientSuffix() {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
            .claim("fhirUser", "https://attacker.example/AlsoAPatient/abc-123")
            .expirationTime(new Date(System.currentTimeMillis() + 60_000))
            .build();
        assertNull(SmartAuthorizationInterceptor.resolvePatientContext(claims));
    }

    @Test
    void parsedScope_compactPermissions() {
        var rs = SmartAuthorizationInterceptor.ParsedScope.parse("patient/Patient.rs");
        assertNotNull(rs);
        assertEquals("patient", rs.compartment());
        assertEquals("Patient", rs.resourceType());
        assertTrue(rs.canRead());
        assertFalse(rs.canWrite());
        assertFalse(rs.canDelete());

        var cruds = SmartAuthorizationInterceptor.ParsedScope.parse("user/*.cruds");
        assertNotNull(cruds);
        assertTrue(cruds.canRead());
        assertTrue(cruds.canWrite());
        assertTrue(cruds.canDelete());

        var w = SmartAuthorizationInterceptor.ParsedScope.parse("patient/Appointment.cud");
        assertNotNull(w);
        assertFalse(w.canRead());
        assertTrue(w.canWrite());
        assertTrue(w.canDelete());
    }

    @Test
    void parsedScope_v1ReadAndWrite() {
        var read = SmartAuthorizationInterceptor.ParsedScope.parse("patient/Patient.read");
        assertNotNull(read);
        assertTrue(read.canRead());
        assertFalse(read.canWrite());

        var write = SmartAuthorizationInterceptor.ParsedScope.parse("patient/Appointment.write");
        assertNotNull(write);
        assertTrue(write.canWrite());
        assertTrue(write.canDelete());
        assertFalse(write.canRead());

        var star = SmartAuthorizationInterceptor.ParsedScope.parse("user/*.*");
        assertNotNull(star);
        assertTrue(star.canRead());
        assertTrue(star.canWrite());
        assertTrue(star.canDelete());
    }

    @Test
    void parsedScope_rejectsIdentityScopes() {
        assertNull(SmartAuthorizationInterceptor.ParsedScope.parse("openid"));
        assertNull(SmartAuthorizationInterceptor.ParsedScope.parse("fhirUser"));
        assertNull(SmartAuthorizationInterceptor.ParsedScope.parse("profile"));
        assertNull(SmartAuthorizationInterceptor.ParsedScope.parse("udap"));
    }

    @Test
    void parsedScope_rejectsUnknownCompartments() {
        assertNull(SmartAuthorizationInterceptor.ParsedScope.parse("admin/Patient.rs"));
    }

    @Test
    void parsedScope_rejectsMalformed() {
        assertNull(SmartAuthorizationInterceptor.ParsedScope.parse("user/"));
        assertNull(SmartAuthorizationInterceptor.ParsedScope.parse("user/Patient"));
        assertNull(SmartAuthorizationInterceptor.ParsedScope.parse("/Patient.rs"));
    }
}
