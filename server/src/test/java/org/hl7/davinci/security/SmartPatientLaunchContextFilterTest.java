package org.hl7.davinci.security;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import static org.junit.jupiter.api.Assertions.*;

class SmartPatientLaunchContextFilterTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void practitionerStandaloneLaunchWithClientSuppliedPatientIdStillRequiresSelection() throws Exception {
        FhirUserDetailsService userDetailsService = new StubFhirUserDetailsService(Map.of(
            "practitioner-1", practitionerUser()
        ));
        SmartPatientLaunchContextFilter filter = new SmartPatientLaunchContextFilter(userDetailsService);
        SecurityContextHolder.getContext().setAuthentication(authenticatedUser("practitioner-1"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/oauth2/authorize");
        String query = "response_type=code&scope=launch/patient%20patient/Patient.rs&smart_patient_id=patient-99";
        request.setQueryString(query);
        request.addParameter("response_type", "code");
        request.addParameter("scope", "launch/patient patient/Patient.rs");
        request.addParameter("smart_patient_id", "patient-99");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertEquals("/oauth2/smart/select-patient", response.getRedirectedUrl());
        String savedQuery = (String) request.getSession().getAttribute(
            SmartPatientLaunchContextFilter.SAVED_AUTHORIZATION_QUERY);
        assertNotNull(savedQuery);
        assertTrue(savedQuery.contains("response_type=code"));
        assertTrue(savedQuery.contains("scope="));
        assertFalse(savedQuery.contains("smart_patient_id"));
    }

    @Test
    void authorizationRequestWithUntrustedSelectionContextIsRejected() throws Exception {
        SmartPatientLaunchContextFilter filter = new SmartPatientLaunchContextFilter(
            new StubFhirUserDetailsService(Map.of()));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/oauth2/authorize");
        request.addParameter(SmartLaunchService.SELECTED_PATIENT_CONTEXT_PARAMETER, "client-supplied-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertEquals(400, response.getStatus());
    }

    private static TestingAuthenticationToken authenticatedUser(String username) {
        TestingAuthenticationToken authentication = new TestingAuthenticationToken(username, "password");
        authentication.setAuthenticated(true);
        return authentication;
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
