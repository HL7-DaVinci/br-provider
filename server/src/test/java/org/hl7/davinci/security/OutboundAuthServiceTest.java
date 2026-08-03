package org.hl7.davinci.security;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.hl7.davinci.config.ServerProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OutboundAuthServiceTest {

    static final String OPEN_PAYER = "http://open-payer.test/fhir";
    static final String AUTH_PAYER = "http://auth-payer.test/fhir";
    static final String UNDECLARED_PAYER = "http://undeclared-payer.test/fhir";
    static final String OPEN_PROVIDER = "http://open-provider.test/fhir";
    static final String RUNTIME_SERVER = "http://runtime.test/fhir/r4";
    static final String SMART_BACKEND_PAYER = "http://smart-backend-payer.test/fhir";

    ServerProperties serverProperties;
    OutboundAuthService service;

    @BeforeEach
    void setUp() {
        serverProperties = new ServerProperties("http://local.test/fhir", List.of(
            providerServer(OPEN_PROVIDER, false)));
        serverProperties.getPayerServers().addAll(List.of(
            payerServer(OPEN_PAYER, false),
            payerServer(AUTH_PAYER, true),
            payerServer(UNDECLARED_PAYER, null),
            smartBackendPayerServer(SMART_BACKEND_PAYER)));
        service = new OutboundAuthService(serverProperties);
    }

    static ServerProperties.ProviderServer providerServer(String url, Boolean requiresAuth) {
        var s = new ServerProperties.ProviderServer();
        s.setUrl(url);
        s.setRequiresAuth(requiresAuth);
        return s;
    }

    static ServerProperties.PayerServer payerServer(String fhirUrl, Boolean requiresAuth) {
        var s = new ServerProperties.PayerServer();
        s.setFhirUrl(fhirUrl);
        s.setRequiresAuth(requiresAuth);
        return s;
    }

    static ServerProperties.PayerServer smartBackendPayerServer(String fhirUrl) {
        var s = new ServerProperties.PayerServer();
        s.setFhirUrl(fhirUrl);
        s.setRequiresAuth(true);
        s.setAuthType("smart-backend");
        return s;
    }

    @Test
    void configuredOpenPayer_isOpen() {
        assertEquals(OutboundAuthService.Mode.OPEN, service.modeFor(OPEN_PAYER));
    }

    @Test
    void configuredAuthPayer_isUdapB2b() {
        assertEquals(OutboundAuthService.Mode.UDAP_B2B, service.modeFor(AUTH_PAYER));
    }

    @Test
    void configuredPayerWithoutFlag_isUnknown() {
        assertEquals(OutboundAuthService.Mode.UNKNOWN, service.modeFor(UNDECLARED_PAYER));
    }

    @Test
    void configuredOpenProvider_isOpen() {
        assertEquals(OutboundAuthService.Mode.OPEN, service.modeFor(OPEN_PROVIDER));
    }

    @Test
    void unconfiguredServer_isUnknown() {
        assertEquals(OutboundAuthService.Mode.UNKNOWN, service.modeFor(RUNTIME_SERVER));
    }

    @Test
    void recordAuthRequired_isLearned() {
        service.recordAuthRequired(RUNTIME_SERVER);
        assertEquals(OutboundAuthService.Mode.UDAP_B2B, service.modeFor(RUNTIME_SERVER));
    }

    @Test
    void recordOpen_isLearned() {
        service.recordOpen(RUNTIME_SERVER);
        assertEquals(OutboundAuthService.Mode.OPEN, service.modeFor(RUNTIME_SERVER));
    }

    @Test
    void configHint_beatsLearnedMode() {
        service.recordAuthRequired(OPEN_PAYER);
        assertEquals(OutboundAuthService.Mode.OPEN, service.modeFor(OPEN_PAYER));
    }

    @Test
    void trailingSlash_normalizedForLookupAndRecord() {
        service.recordOpen(RUNTIME_SERVER + "/");
        assertEquals(OutboundAuthService.Mode.OPEN, service.modeFor(RUNTIME_SERVER));
        assertEquals(OutboundAuthService.Mode.OPEN, service.modeFor(RUNTIME_SERVER + "/"));
    }

    @Test
    void undeclaredConfiguredPayer_canLearn() {
        service.recordAuthRequired(UNDECLARED_PAYER);
        assertEquals(OutboundAuthService.Mode.UDAP_B2B, service.modeFor(UNDECLARED_PAYER));
    }

    @Test
    void configuredSmartBackendPayer_isSmartBackend() {
        assertEquals(OutboundAuthService.Mode.SMART_BACKEND, service.modeFor(SMART_BACKEND_PAYER));
    }
}
