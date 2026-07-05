package org.hl7.davinci.pas;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Extension;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import ca.uhn.fhir.jpa.api.dao.DaoRegistry;
import ca.uhn.fhir.jpa.api.dao.IFhirResourceDao;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.api.server.SystemRequestDetails;
import ca.uhn.fhir.jpa.api.model.DaoMethodOutcome;
import ca.uhn.fhir.rest.server.SimpleBundleProvider;

class PasResolutionServiceTest {

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void applyResolution_upsertsClaimResponseAndUpdatesTaskStatusAndOutput() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao crDao = mock(IFhirResourceDao.class);
    IFhirResourceDao taskDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("ClaimResponse")).thenReturn(crDao);
    when(daoRegistry.getResourceDao("Task")).thenReturn(taskDao);

    DaoMethodOutcome crOutcome = new DaoMethodOutcome();
    crOutcome.setId(new IdType("ClaimResponse", "cr-123"));
    when(crDao.update(any(), anyString(), any(RequestDetails.class))).thenReturn(crOutcome);

    Task task = new Task();
    task.addIdentifier().setValue("trk-1");
    when(taskDao.search(any(), any())).thenReturn(new SimpleBundleProvider(task));

    ClaimResponse cr = new ClaimResponse();
    cr.addIdentifier().setValue("trk-1");
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
    cr.setPreAuthRef("AUTH-1");

    new PasResolutionService(daoRegistry).applyResolution(cr);

    verify(crDao).update(eq(cr), contains("identifier=trk-1"), any(RequestDetails.class));
    ArgumentCaptor<Task> taskCaptor = ArgumentCaptor.forClass(Task.class);
    verify(taskDao).update(taskCaptor.capture(), any(SystemRequestDetails.class));
    Task updated = taskCaptor.getValue();
    assertEquals("completed", updated.getStatus().toCode());
    assertTrue(updated.getOutput().stream().anyMatch(out ->
        out.getValue() instanceof Reference ref && "ClaimResponse/cr-123".equals(ref.getReference())));
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void applyResolution_blanksPayerReferencesAndAdoptsPatientFromTask() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao crDao = mock(IFhirResourceDao.class);
    IFhirResourceDao taskDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("ClaimResponse")).thenReturn(crDao);
    when(daoRegistry.getResourceDao("Task")).thenReturn(taskDao);
    DaoMethodOutcome crOutcome = new DaoMethodOutcome();
    crOutcome.setId(new IdType("ClaimResponse", "cr-1"));
    when(crDao.update(any(), anyString(), any(RequestDetails.class))).thenReturn(crOutcome);

    Task task = new Task();
    task.addIdentifier().setValue("trk-1");
    task.setFor(new Reference("Patient/pat014"));
    when(taskDao.search(any(), any())).thenReturn(new SimpleBundleProvider(task));
    when(taskDao.update(any(), any(SystemRequestDetails.class))).thenReturn(new DaoMethodOutcome());

    ClaimResponse cr = new ClaimResponse();
    cr.addIdentifier().setValue("trk-1");
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
    cr.setRequest(new Reference("Claim/1821"));
    cr.setPatient(new Reference("Patient/1822"));
    cr.setRequestor(new Reference("Organization/1823"));
    cr.setInsurer(new Reference("Organization/1824"));
    cr.addCommunicationRequest(new Reference("CommunicationRequest/1825"));

    new PasResolutionService(daoRegistry).applyResolution(cr);

    ArgumentCaptor<ClaimResponse> captor = ArgumentCaptor.forClass(ClaimResponse.class);
    verify(crDao).update(captor.capture(), anyString(), any(RequestDetails.class));
    ClaimResponse stored = captor.getValue();
    assertNull(stored.getRequest().getReference());
    assertNull(stored.getRequestor().getReference());
    assertNull(stored.getInsurer().getReference());
    assertNull(stored.getCommunicationRequestFirstRep().getReference());
    assertEquals("Patient/pat014", stored.getPatient().getReference(),
        "Patient must come from the correlated Task's Task.for, not the payer reference");
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void applyResolution_blanksPatientWhenNoTaskCorrelates() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao crDao = mock(IFhirResourceDao.class);
    IFhirResourceDao taskDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("ClaimResponse")).thenReturn(crDao);
    when(daoRegistry.getResourceDao("Task")).thenReturn(taskDao);
    DaoMethodOutcome crOutcome = new DaoMethodOutcome();
    crOutcome.setId(new IdType("ClaimResponse", "cr-2"));
    when(crDao.update(any(), anyString(), any(RequestDetails.class))).thenReturn(crOutcome);
    when(taskDao.search(any(), any())).thenReturn(new SimpleBundleProvider());

    ClaimResponse cr = new ClaimResponse();
    cr.addIdentifier().setValue("trk-9");
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
    cr.setPatient(new Reference("Patient/1822"));

    new PasResolutionService(daoRegistry).applyResolution(cr);

    ArgumentCaptor<ClaimResponse> captor = ArgumentCaptor.forClass(ClaimResponse.class);
    verify(crDao).update(captor.capture(), anyString(), any(RequestDetails.class));
    assertNull(captor.getValue().getPatient().getReference());
  }

  @Test
  void mapOutcomeToTaskStatus_mapsLifecycle() {
    assertEquals("completed",
        PasResolutionService.mapOutcomeToTaskStatus(ClaimResponse.RemittanceOutcome.COMPLETE));
    assertEquals("in-progress",
        PasResolutionService.mapOutcomeToTaskStatus(ClaimResponse.RemittanceOutcome.QUEUED));
    assertEquals("in-progress",
        PasResolutionService.mapOutcomeToTaskStatus(ClaimResponse.RemittanceOutcome.PARTIAL));
    assertEquals("failed",
        PasResolutionService.mapOutcomeToTaskStatus(ClaimResponse.RemittanceOutcome.ERROR));
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void applyResolution_keepsPendedCompleteResponseInProgress() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao crDao = mock(IFhirResourceDao.class);
    IFhirResourceDao taskDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("ClaimResponse")).thenReturn(crDao);
    when(daoRegistry.getResourceDao("Task")).thenReturn(taskDao);

    DaoMethodOutcome crOutcome = new DaoMethodOutcome();
    crOutcome.setId(new IdType("ClaimResponse", "cr-124"));
    when(crDao.update(any(), anyString(), any(RequestDetails.class))).thenReturn(crOutcome);

    Task task = new Task();
    task.addIdentifier().setValue("trk-2");
    when(taskDao.search(any(), any())).thenReturn(new SimpleBundleProvider(task));

    ClaimResponse cr = claimResponseWithReviewAction("A4");
    cr.getIdentifier().clear();
    cr.addIdentifier().setValue("trk-2");

    new PasResolutionService(daoRegistry).applyResolution(cr);

    ArgumentCaptor<Task> taskCaptor = ArgumentCaptor.forClass(Task.class);
    verify(taskDao).update(taskCaptor.capture(), any(SystemRequestDetails.class));
    assertEquals("in-progress", taskCaptor.getValue().getStatus().toCode());
  }

  @Test
  void isPended_detectsPendFromOutcomeCompletePlusItemReviewActionA4() {
    assertTrue(PasResolutionService.isPended(claimResponseWithReviewAction("A4")));
  }

  @Test
  void isPended_doesNotFlagApprovedItemsAsPended() {
    assertFalse(PasResolutionService.isPended(claimResponseWithReviewAction("A1")));
  }

  @Test
  void isPended_stillDetectsLegacyOutcomeQueuedDuringTheTransition() {
    ClaimResponse cr = new ClaimResponse();
    cr.setOutcome(ClaimResponse.RemittanceOutcome.QUEUED);
    assertTrue(PasResolutionService.isPended(cr));
  }

  private static ClaimResponse claimResponseWithReviewAction(String code) {
    ClaimResponse cr = new ClaimResponse();
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
    ClaimResponse.ItemComponent item = cr.addItem();
    item.setItemSequence(1);
    ClaimResponse.AdjudicationComponent adjudication = item.addAdjudication();
    adjudication.getCategory().addCoding().setCode("submitted");
    Extension reviewAction = adjudication.addExtension();
    reviewAction.setUrl("http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction");
    Extension reviewActionCode = reviewAction.addExtension();
    reviewActionCode.setUrl("http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewActionCode");
    CodeableConcept concept = new CodeableConcept();
    concept.addCoding(new Coding("https://codesystem.x12.org/005010/306", code, null));
    reviewActionCode.setValue(concept);
    return cr;
  }
}
