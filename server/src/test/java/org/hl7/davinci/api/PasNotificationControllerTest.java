package org.hl7.davinci.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.hl7.davinci.pas.PasResolutionService;
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

  @Test
  void receive_parsesNestedClaimResponseAndAppliesResolution() {
    PasResolutionService resolution = mock(PasResolutionService.class);
    PasNotificationController controller =
        new PasNotificationController(resolution, FhirContext.forR4(), new ObjectMapper());

    assertEquals(200, controller.receive(NESTED_NOTIFICATION).getStatusCode().value());

    ArgumentCaptor<ClaimResponse> captor = ArgumentCaptor.forClass(ClaimResponse.class);
    verify(resolution).applyResolution(captor.capture());
    assertEquals("trk-1", captor.getValue().getIdentifierFirstRep().getValue());
    assertEquals("complete", captor.getValue().getOutcome().toCode());
  }
}
