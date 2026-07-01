package org.hl7.davinci.api;

import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.SpaAuthController;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ProxyUtilTest {

    @Test
    void payerScopesForOp_defaultsToReadWhenMissingOrBlank() {
        assertEquals(ProxyUtil.FHIR_READ_SCOPES, ProxyUtil.payerScopesForOp(null));
        assertEquals(ProxyUtil.FHIR_READ_SCOPES, ProxyUtil.payerScopesForOp(""));
        assertEquals(ProxyUtil.FHIR_READ_SCOPES, ProxyUtil.payerScopesForOp("  "));
        assertEquals(ProxyUtil.FHIR_READ_SCOPES, ProxyUtil.payerScopesForOp("read"));
    }

    @Test
    void payerScopesForOp_resolvesLeastPrivilegePerOperation() {
        assertEquals(ProxyUtil.PAS_SCOPES, ProxyUtil.payerScopesForOp("pas-submit"));
        assertEquals(ProxyUtil.DTR_SCOPES, ProxyUtil.payerScopesForOp("dtr"));
        assertEquals(ProxyUtil.SUBMIT_ATTACHMENT_SCOPES,
            ProxyUtil.payerScopesForOp("submit-attachment"));
        assertEquals(ProxyUtil.SUBSCRIPTION_SCOPES, ProxyUtil.payerScopesForOp("subscription"));
    }

    @Test
    void payerScopesForOp_rejectsUnknownKey() {
        assertThrows(IllegalArgumentException.class,
            () -> ProxyUtil.payerScopesForOp("system/*.*"));
        assertThrows(IllegalArgumentException.class,
            () -> ProxyUtil.payerScopesForOp("delete-everything"));
    }

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
    void getActiveProviderFhirBase_fallsBackToLocalProvider() {
        ServerProperties serverProperties = new ServerProperties("http://localhost:8080/fhir", null);
        MockHttpServletRequest request = new MockHttpServletRequest();

        assertEquals(
            "http://localhost:8080/fhir",
            ProxyUtil.getActiveProviderFhirBase(request, serverProperties)
        );
    }
}
