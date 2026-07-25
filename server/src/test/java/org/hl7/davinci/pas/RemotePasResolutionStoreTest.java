package org.hl7.davinci.pas;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.RETURNS_DEEP_STUBS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;

import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.api.MethodOutcome;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.gclient.ICriterion;
import ca.uhn.fhir.rest.gclient.ICriterionInternal;
import ca.uhn.fhir.rest.gclient.IUpdateWithQuery;
import ca.uhn.fhir.rest.gclient.IUpdateWithQueryTyped;

class RemotePasResolutionStoreTest {

  @Test
  @SuppressWarnings("unchecked")
  void upsertUsesIdentifierConditionalCriterion() {
    IGenericClient client = mock(IGenericClient.class, RETURNS_DEEP_STUBS);
    FhirContext fhirContext = FhirContext.forR4Cached();
    when(client.getFhirContext()).thenReturn(fhirContext);
    MethodOutcome outcome = new MethodOutcome(new IdType("ClaimResponse", "remote-7"));

    ClaimResponse cr = new ClaimResponse();
    cr.setId("payer-assigned-id");

    IUpdateWithQuery conditionalQuery = mock(IUpdateWithQuery.class);
    IUpdateWithQueryTyped queryTyped = mock(IUpdateWithQueryTyped.class);
    ArgumentCaptor<ICriterion<?>> criterionCaptor = ArgumentCaptor.forClass(ICriterion.class);

    when(client.update().resource(cr).conditional()).thenReturn(conditionalQuery);
    when(conditionalQuery.where(criterionCaptor.capture())).thenReturn(queryTyped);
    when(queryTyped.execute()).thenReturn(outcome);

    String id = new RemotePasResolutionStore(client).upsertClaimResponse(cr, "track-1");

    assertEquals("remote-7", id);
    assertNull(cr.getIdElement().getIdPart());

    ICriterionInternal criterion = (ICriterionInternal) criterionCaptor.getValue();
    assertEquals("identifier", criterion.getParameterName());
    assertEquals("track-1", criterion.getParameterValue(fhirContext));
  }

  @Test
  @SuppressWarnings("unchecked")
  void findTasksSearchesByIdentifier() {
    IGenericClient client = mock(IGenericClient.class, RETURNS_DEEP_STUBS);
    FhirContext fhirContext = FhirContext.forR4Cached();
    when(client.getFhirContext()).thenReturn(fhirContext);
    Bundle bundle = new Bundle();
    bundle.addEntry().setResource(new Task().setStatus(Task.TaskStatus.INPROGRESS));
    ArgumentCaptor<ICriterion<?>> criterionCaptor = ArgumentCaptor.forClass(ICriterion.class);
    when(client.search().forResource(Task.class)
        .where(criterionCaptor.capture()).returnBundle(Bundle.class).execute()).thenReturn(bundle);

    List<Task> tasks = new RemotePasResolutionStore(client).findTasksByIdentifier("track-1");
    assertEquals(1, tasks.size());

    ICriterionInternal criterion = (ICriterionInternal) criterionCaptor.getValue();
    assertEquals("identifier", criterion.getParameterName());
    assertEquals("track-1", criterion.getParameterValue(fhirContext));
  }

  @Test
  void findClaimResponseSearchesByIdentifier() {
    IGenericClient client = mock(IGenericClient.class, RETURNS_DEEP_STUBS);
    FhirContext fhirContext = FhirContext.forR4Cached();
    when(client.getFhirContext()).thenReturn(fhirContext);
    Bundle bundle = new Bundle();
    ClaimResponse stored = new ClaimResponse();
    stored.setId("cr-1");
    bundle.addEntry().setResource(stored);
    ArgumentCaptor<ICriterion<?>> criterionCaptor = ArgumentCaptor.forClass(ICriterion.class);
    when(client.search().forResource(ClaimResponse.class)
        .where(criterionCaptor.capture()).returnBundle(Bundle.class).execute()).thenReturn(bundle);

    ClaimResponse found = new RemotePasResolutionStore(client).findClaimResponseByIdentifier("track-1");
    assertEquals("cr-1", found.getIdElement().getIdPart());

    ICriterionInternal criterion = (ICriterionInternal) criterionCaptor.getValue();
    assertEquals("identifier", criterion.getParameterName());
    assertEquals("track-1", criterion.getParameterValue(fhirContext));
  }
}
