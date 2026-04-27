package org.hl7.davinci.security;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import static org.junit.jupiter.api.Assertions.*;

class SmartPatientSelectionControllerTest {

    @Test
    void selectedPatientRedirectUsesServerSideSelectionContext() {
        FhirUserDetailsService userDetailsService = new StubFhirUserDetailsService(Map.of(
            "patient-1", patientUser()
        ));
        SmartLaunchService smartLaunchService = new SmartLaunchService();
        SmartPatientSelectionController controller = new SmartPatientSelectionController(
            userDetailsService,
            smartLaunchService
        );
        MockHttpSession session = new MockHttpSession();
        session.setAttribute(
            SmartPatientLaunchContextFilter.SAVED_AUTHORIZATION_QUERY,
            "response_type=code&scope=launch/patient%20patient/Patient.rs"
        );

        ResponseEntity<String> response = controller.selectPatient(
            "patient-1",
            session,
            authenticatedUser("practitioner-1")
        );

        assertEquals(302, response.getStatusCode().value());
        String location = response.getHeaders().getFirst(HttpHeaders.LOCATION);
        assertNotNull(location);
        assertTrue(location.contains("smart_patient_context="));
        assertFalse(location.contains("smart_patient_id="));
        Object selectedContext = session.getAttribute(SmartPatientLaunchContextFilter.SELECTED_PATIENT_CONTEXT_TOKEN);
        assertNotNull(selectedContext);
        assertTrue(location.contains("smart_patient_context=" + selectedContext));
    }

    private static TestingAuthenticationToken authenticatedUser(String username) {
        TestingAuthenticationToken authentication = new TestingAuthenticationToken(username, "password");
        authentication.setAuthenticated(true);
        return authentication;
    }

    private static FhirUserDetails patientUser() {
        return new FhirUserDetails(
            "patient-1",
            "test",
            "Patient/patient-1",
            "Patient One",
            List.of(new SimpleGrantedAuthority("ROLE_PATIENT"))
        );
    }

    private static class StubFhirUserDetailsService extends FhirUserDetailsService {
        private final Map<String, FhirUserDetails> users;

        StubFhirUserDetailsService(Map<String, FhirUserDetails> users) {
            super(null, null);
            this.users = users;
        }

        @Override
        public FhirUserDetails getFhirUser(String username) {
            return users.get(username);
        }

        @Override
        public Collection<FhirUserDetails> getAllUsers() {
            return users.values();
        }
    }
}
