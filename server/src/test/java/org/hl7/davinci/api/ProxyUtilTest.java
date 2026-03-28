package org.hl7.davinci.api;

import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.SpaAuthController;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.junit.jupiter.api.Assertions.assertEquals;

class ProxyUtilTest {

    @Test
    void getActiveProviderFhirBase_usesSessionServerWhenPresent() {
        ServerProperties serverProperties = new ServerProperties("http://localhost:8080/fhir", null);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute(
            SpaAuthController.SESSION_SERVER_URL,
            "https://external.example/fhir/"
        );

        assertEquals(
            "https://external.example/fhir",
            ProxyUtil.getActiveProviderFhirBase(request, serverProperties)
        );
    }

    @Test
    void getActiveProviderFhirBase_prefersRequestedProviderHeader() {
        ServerProperties serverProperties = new ServerProperties("http://localhost:8080/fhir", null);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute(
            SpaAuthController.SESSION_SERVER_URL,
            "https://session.example/fhir"
        );
        request.addHeader(
            ProxyUtil.ACTIVE_PROVIDER_FHIR_BASE_HEADER,
            "https://custom.example/fhir/"
        );

        assertEquals(
            "https://custom.example/fhir",
            ProxyUtil.getActiveProviderFhirBase(request, serverProperties)
        );
    }

    @Test
    void getActiveProviderFhirBase_fallsBackToLocalProvider() {
        ServerProperties serverProperties = new ServerProperties("http://localhost:8080/fhir", null);
        MockHttpServletRequest request = new MockHttpServletRequest();

        assertEquals(
            "http://localhost:8080/fhir",
            ProxyUtil.getActiveProviderFhirBase(request, serverProperties)
        );
    }
}
