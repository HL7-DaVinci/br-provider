package org.hl7.davinci.security;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import static org.junit.jupiter.api.Assertions.*;

class SmartLaunchServiceTest {

    @Test
    void ehrLaunchContext_isSingleUseWhenResolvedForToken() {
        SmartLaunchService service = new SmartLaunchService();
        String launch = service.createLaunchContext(
            "patient-1",
            "encounter-1",
            List.of("Coverage/cov-1", "ServiceRequest/order-1"),
            "assertion-1",
            List.of("http://example.org/q"),
            null
        );

        SmartLaunchService.ResolvedLaunchContext resolved = service.resolveForToken(
            launch,
            Set.of("launch", "patient/Patient.rs"),
            practitionerUser(),
            null
        );

        assertNotNull(resolved);
        assertEquals("patient-1", resolved.patientId());
        assertEquals("encounter-1", resolved.encounterId());
        assertEquals(List.of("Coverage/cov-1", "ServiceRequest/order-1"), resolved.fhirContextReferences());
        assertNull(service.resolveForToken(launch, Set.of("launch"), practitionerUser(), null));
    }

    @Test
    void standalonePatientLaunch_usesPatientUserSelfContext() {
        SmartLaunchService service = new SmartLaunchService();

        SmartLaunchService.ResolvedLaunchContext resolved = service.resolveForToken(
            null,
            Set.of("launch/patient", "patient/Patient.rs"),
            patientUser(),
            null
        );

        assertNotNull(resolved);
        assertEquals("patient-2", resolved.patientId());
        assertNull(resolved.encounterId());
        assertTrue(resolved.fhirContextReferences().isEmpty());
    }

    @Test
    void standalonePatientLaunch_usesSelectedPractitionerContext() {
        SmartLaunchService service = new SmartLaunchService();
        String selectedContext = service.createSelectedPatientContext("patient-3", "practitioner-1");

        SmartLaunchService.ResolvedLaunchContext resolved = service.resolveForToken(
            null,
            Set.of("launch/patient", "patient/Patient.rs"),
            practitionerUser(),
            selectedContext
        );

        assertNotNull(resolved);
        assertEquals("patient-3", resolved.patientId());
    }

    @Test
    void standalonePatientLaunch_doesNotTrustRawPatientIdForPractitionerContext() {
        SmartLaunchService service = new SmartLaunchService();

        SmartLaunchService.ResolvedLaunchContext resolved = service.resolveForToken(
            null,
            Set.of("launch/patient", "patient/Patient.rs"),
            practitionerUser(),
            "patient-3"
        );

        assertNull(resolved);
    }

    @Test
    void standalonePatientLaunch_selectionContextIsBoundToUserAndSingleUse() {
        SmartLaunchService service = new SmartLaunchService();
        String selectedContext = service.createSelectedPatientContext("patient-3", "practitioner-1");

        assertNull(service.resolveForToken(
            null,
            Set.of("launch/patient", "patient/Patient.rs"),
            otherPractitionerUser(),
            selectedContext
        ));
        SmartLaunchService.ResolvedLaunchContext resolved = service.resolveForToken(
            null,
            Set.of("launch/patient", "patient/Patient.rs"),
            practitionerUser(),
            selectedContext
        );

        assertNotNull(resolved);
        assertEquals("patient-3", resolved.patientId());
        assertNull(service.resolveForToken(
            null,
            Set.of("launch/patient", "patient/Patient.rs"),
            practitionerUser(),
            selectedContext
        ));
    }

    @Test
    void standalonePatientLaunch_patientUserAlwaysUsesSelfContext() {
        SmartLaunchService service = new SmartLaunchService();
        String selectedContext = service.createSelectedPatientContext("patient-3", "patient-2");

        SmartLaunchService.ResolvedLaunchContext resolved = service.resolveForToken(
            null,
            Set.of("launch/patient", "patient/Patient.rs"),
            patientUser(),
            selectedContext
        );

        assertNotNull(resolved);
        assertEquals("patient-2", resolved.patientId());
    }

    private static FhirUserDetails patientUser() {
        return new FhirUserDetails(
            "patient-2",
            "test",
            "Patient/patient-2",
            "Patient Two",
            List.of(new SimpleGrantedAuthority("ROLE_PATIENT"))
        );
    }

    private static FhirUserDetails practitionerUser() {
        return new FhirUserDetails(
            "practitioner-1",
            "test",
            "Practitioner/practitioner-1",
            "Practitioner One",
            List.of(new SimpleGrantedAuthority("ROLE_PRACTITIONER"))
        );
    }

    private static FhirUserDetails otherPractitionerUser() {
        return new FhirUserDetails(
            "practitioner-2",
            "test",
            "Practitioner/practitioner-2",
            "Practitioner Two",
            List.of(new SimpleGrantedAuthority("ROLE_PRACTITIONER"))
        );
    }
}
