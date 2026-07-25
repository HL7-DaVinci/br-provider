package org.hl7.davinci.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.List;

import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.pas.LocalPasResolutionStore;
import org.hl7.davinci.pas.PasResolutionService;
import org.hl7.davinci.pas.PasResolutionStore;
import org.hl7.davinci.pas.RemotePasResolutionStore;
import org.hl7.davinci.security.B2BTokenService;
import org.hl7.davinci.security.OutboundAuthService;
import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.fasterxml.jackson.databind.ObjectMapper;

import ca.uhn.fhir.context.FhirContext;

class PasNotificationControllerTest {

  // The R4-backport notification nests the PAS Response Bundle (which holds the ClaimResponse) as an
  // entry resource alongside the SubscriptionStatus Parameters. The receiver must recurse to find it.
  private static final String NESTED_NOTIFICATION = """
      {"resourceType":"Bundle","type":"history","entry":[
        {"resource":{"resourceType":"Parameters"}},
        {"resource":{"resourceType":"Bundle","type":"collection","entry":[
          {"resource":{"resourceType":"ClaimResponse","outcome":"complete","preAuthRef":"AUTH-1",
            "identifier":[{"value":"trk-1"}]}}
        ]}}
      ]}""";

  private static ServerProperties trustedProperties() {
    ServerProperties.ProviderServer ehr = new ServerProperties.ProviderServer();
    ehr.setName("Trusted EHR");
    ehr.setUrl("https://ehr.example.com/fhir");
    return new ServerProperties("http://localhost:8080/fhir", List.of(ehr));
  }

  private static B2BTokenService noTokenB2BService() {
    B2BTokenService b2bTokenService = mock(B2BTokenService.class);
    return b2bTokenService;
  }

  private static OutboundTargetValidator defaultValidator() {
    return new OutboundTargetValidator(new SecurityProperties());
  }

  @Test
  void receive_parsesNestedClaimResponseAndAppliesResolution() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, noTokenB2BService(), new OutboundAuthService(serverProperties), defaultValidator());

    assertEquals(200, controller.receive(NESTED_NOTIFICATION, null).getStatusCode().value());

    ArgumentCaptor<ClaimResponse> captor = ArgumentCaptor.forClass(ClaimResponse.class);
    verify(resolution).applyResolution(captor.capture(), any(PasResolutionStore.class));
    assertEquals("trk-1", captor.getValue().getIdentifierFirstRep().getValue());
    assertEquals("complete", captor.getValue().getOutcome().toCode());

    assertEquals(1, devActivity.list().size());
    assertEquals("pas-decision", devActivity.list().get(0).category());
  }

  @Test
  void receive_handshakeWithoutClaimResponseRecordsSubscriptionEvent() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, noTokenB2BService(), new OutboundAuthService(serverProperties), defaultValidator());

    String handshake = "{\"resourceType\":\"Bundle\",\"type\":\"history\",\"entry\":[" +
        "{\"resource\":{\"resourceType\":\"Parameters\"}}]}";
    assertEquals(200, controller.receive(handshake, null).getStatusCode().value());

    assertEquals(1, devActivity.list().size());
    assertEquals("subscription-event", devActivity.list().get(0).category());
  }

  @Test
  void untrustedEhrIsRejected() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, noTokenB2BService(), new OutboundAuthService(serverProperties), defaultValidator());

    assertEquals(422,
        controller.receive(NESTED_NOTIFICATION, "https://evil.example.com/fhir?x=1").getStatusCode().value());

    verify(resolution, never()).applyResolution(any(ClaimResponse.class), any(PasResolutionStore.class));
  }

  @Test
  void unconfiguredPublicEhr_passingValidator_usesRemoteStore() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    SecurityProperties securityProperties = new SecurityProperties();
    securityProperties.setAllowedLocalHosts(List.of("candle.test"));
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, noTokenB2BService(), new OutboundAuthService(serverProperties),
        new OutboundTargetValidator(securityProperties));

    assertEquals(200,
        controller.receive(NESTED_NOTIFICATION, "http://candle.test/fhir/r4").getStatusCode().value());

    ArgumentCaptor<PasResolutionStore> captor = ArgumentCaptor.forClass(PasResolutionStore.class);
    verify(resolution).applyResolution(any(ClaimResponse.class), captor.capture());
    assertEquals(RemotePasResolutionStore.class, captor.getValue().getClass());
  }

  @Test
  void unconfiguredValidatorPassingEhr_neverAttemptsTokenMint() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    SecurityProperties securityProperties = new SecurityProperties();
    securityProperties.setAllowedLocalHosts(List.of("candle.test"));
    B2BTokenService b2bTokenService = noTokenB2BService();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, b2bTokenService, new OutboundAuthService(serverProperties),
        new OutboundTargetValidator(securityProperties));

    assertEquals(200,
        controller.receive(NESTED_NOTIFICATION, "http://candle.test/fhir/r4").getStatusCode().value());

    verifyNoInteractions(b2bTokenService);
    ArgumentCaptor<PasResolutionStore> captor = ArgumentCaptor.forClass(PasResolutionStore.class);
    verify(resolution).applyResolution(any(ClaimResponse.class), captor.capture());
    assertEquals(RemotePasResolutionStore.class, captor.getValue().getClass());
  }

  @Test
  void unconfiguredEhr_failingValidator_returns422NoWrite() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, noTokenB2BService(), new OutboundAuthService(serverProperties), defaultValidator());

    assertEquals(422,
        controller.receive(NESTED_NOTIFICATION, "http://unconfigured.test/fhir?x=1").getStatusCode().value());

    verify(resolution, never()).applyResolution(any(ClaimResponse.class), any(PasResolutionStore.class));
  }

  @Test
  void trustedEhrRemoteWriteFailureReturns502() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    doThrow(new RuntimeException("remote write failed"))
        .when(resolution).applyResolution(any(ClaimResponse.class), any(PasResolutionStore.class));
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, noTokenB2BService(), new OutboundAuthService(serverProperties), defaultValidator());

    assertEquals(502,
        controller.receive(NESTED_NOTIFICATION, "https://ehr.example.com/fhir").getStatusCode().value());

    assertEquals(1, devActivity.list().size());
    assertEquals(502, devActivity.list().get(0).status());
    assertEquals("pas-decision-error", devActivity.list().get(0).category());
  }

  @Test
  void malformedClaimResponseReturns400() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, noTokenB2BService(), new OutboundAuthService(serverProperties), defaultValidator());

    String malformed = """
        {"resourceType":"Bundle","type":"history","entry":[
          {"resource":{"resourceType":"Parameters"}},
          {"resource":{"resourceType":"Bundle","type":"collection","entry":[
            {"resource":{"resourceType":"ClaimResponse","outcome":"complete",
              "identifier":[{"value":"trk-1"}],"extension":"not-an-array"}}
          ]}}
        ]}""";

    assertEquals(400, controller.receive(malformed, null).getStatusCode().value());

    verify(resolution, never()).applyResolution(any(ClaimResponse.class), any(PasResolutionStore.class));
    assertEquals(1, devActivity.list().size());
    assertEquals(400, devActivity.list().get(0).status());
    assertFalse(devActivity.list().isEmpty());
    assertTrue(devActivity.list().get(0).category().equals("pas-decision-error"));
  }

  @Test
  void trustedRemoteEhrUsesRemoteStore() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, noTokenB2BService(), new OutboundAuthService(serverProperties), defaultValidator());

    assertEquals(200,
        controller.receive(NESTED_NOTIFICATION, "https://ehr.example.com/fhir").getStatusCode().value());

    ArgumentCaptor<PasResolutionStore> captor = ArgumentCaptor.forClass(PasResolutionStore.class);
    verify(resolution).applyResolution(any(ClaimResponse.class), captor.capture());
    assertEquals(RemotePasResolutionStore.class, captor.getValue().getClass());
  }

  @Test
  void absentEhrParamUsesLocalStore() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties serverProperties = trustedProperties();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, noTokenB2BService(), new OutboundAuthService(serverProperties), defaultValidator());

    assertEquals(200, controller.receive(NESTED_NOTIFICATION, null).getStatusCode().value());

    ArgumentCaptor<PasResolutionStore> captor = ArgumentCaptor.forClass(PasResolutionStore.class);
    verify(resolution).applyResolution(any(ClaimResponse.class), captor.capture());
    assertEquals(localStore, captor.getValue());
  }

  @Test
  void trustedOpenEhr_neverAttemptsTokenMint() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    LocalPasResolutionStore localStore = mock(LocalPasResolutionStore.class);
    DevActivityController devActivity = new DevActivityController();
    ServerProperties.ProviderServer ehr = new ServerProperties.ProviderServer();
    ehr.setName("Open EHR");
    ehr.setUrl("https://ehr.example.com/fhir");
    ehr.setRequiresAuth(false);
    ServerProperties serverProperties = new ServerProperties("http://localhost:8080/fhir", List.of(ehr));
    B2BTokenService b2bTokenService = noTokenB2BService();
    PasNotificationController controller = new PasNotificationController(
        resolution, localStore, FhirContext.forR4(), new ObjectMapper(), devActivity,
        serverProperties, b2bTokenService, new OutboundAuthService(serverProperties), defaultValidator());

    assertEquals(200,
        controller.receive(NESTED_NOTIFICATION, "https://ehr.example.com/fhir").getStatusCode().value());

    verifyNoInteractions(b2bTokenService);
    ArgumentCaptor<PasResolutionStore> captor = ArgumentCaptor.forClass(PasResolutionStore.class);
    verify(resolution).applyResolution(any(ClaimResponse.class), captor.capture());
    assertEquals(RemotePasResolutionStore.class, captor.getValue().getClass());
  }
}
