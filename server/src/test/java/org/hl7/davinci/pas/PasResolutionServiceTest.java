package org.hl7.davinci.pas;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Extension;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;

class PasResolutionServiceTest {

  static class FakeStore implements PasResolutionStore {
    List<Task> tasks = new ArrayList<>();
    ClaimResponse existing;
    ClaimResponse upserted;
    String upsertedTrackingId;
    List<Task> updatedTasks = new ArrayList<>();

    @Override
    public List<Task> findTasksByIdentifier(String trackingId) {
      return tasks;
    }

    @Override
    public ClaimResponse findClaimResponseByIdentifier(String trackingId) {
      return existing;
    }

    @Override
    public String upsertClaimResponse(ClaimResponse cr, String trackingId) {
      this.upserted = cr;
      this.upsertedTrackingId = trackingId;
      return "cr-1";
    }

    @Override
    public void updateTask(Task task) {
      updatedTasks.add(task);
    }
  }

  @Test
  void applyResolution_upsertsClaimResponseAndUpdatesTaskStatusAndOutput() {
    FakeStore store = new FakeStore();
    Task task = new Task();
    task.addIdentifier().setValue("trk-1");
    store.tasks.add(task);

    ClaimResponse cr = new ClaimResponse();
    cr.addIdentifier().setValue("trk-1");
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
    cr.setPreAuthRef("AUTH-1");

    new PasResolutionService().applyResolution(cr, store);

    assertEquals(cr, store.upserted);
    assertEquals("trk-1", store.upsertedTrackingId);
    Task updated = store.updatedTasks.get(0);
    assertEquals("completed", updated.getStatus().toCode());
    assertTrue(updated.getOutput().stream().anyMatch(out ->
        out.getValue() instanceof Reference ref && "ClaimResponse/cr-1".equals(ref.getReference())));
  }

  @Test
  void applyResolution_blanksPayerReferencesAndAdoptsPatientFromTask() {
    FakeStore store = new FakeStore();
    Task task = new Task();
    task.addIdentifier().setValue("trk-1");
    task.setFor(new Reference("Patient/pat014"));
    store.tasks.add(task);

    ClaimResponse cr = new ClaimResponse();
    cr.addIdentifier().setValue("trk-1");
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
    cr.setRequest(new Reference("Claim/1821"));
    cr.setPatient(new Reference("Patient/1822"));
    cr.setRequestor(new Reference("Organization/1823"));
    cr.setInsurer(new Reference("Organization/1824"));
    cr.addCommunicationRequest(new Reference("CommunicationRequest/1825"));

    new PasResolutionService().applyResolution(cr, store);

    ClaimResponse stored = store.upserted;
    assertNull(stored.getRequest().getReference());
    assertNull(stored.getRequestor().getReference());
    assertNull(stored.getInsurer().getReference());
    assertNull(stored.getCommunicationRequestFirstRep().getReference());
    assertEquals("Patient/pat014", stored.getPatient().getReference(),
        "Patient must come from the correlated Task's Task.for, not the payer reference");
  }

  @Test
  void applyResolution_adoptsRequiredReferencesFromStoredClaimResponse() {
    FakeStore store = new FakeStore();
    Task task = new Task();
    task.addIdentifier().setValue("trk-1");
    store.tasks.add(task);
    ClaimResponse existing = new ClaimResponse();
    existing.setPatient(new Reference("Patient/pat014"));
    existing.setInsurer(new Reference("Organization/local-payer"));
    store.existing = existing;

    ClaimResponse cr = new ClaimResponse();
    cr.addIdentifier().setValue("trk-1");
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
    cr.setPatient(new Reference("Patient/1822"));
    cr.setInsurer(new Reference("Organization/1824"));

    new PasResolutionService().applyResolution(cr, store);

    assertEquals("Patient/pat014", store.upserted.getPatient().getReference(),
        "Patient must come from the stored ClaimResponse when the Task has no Task.for");
    assertEquals("Organization/local-payer", store.upserted.getInsurer().getReference(),
        "Insurer must come from the stored ClaimResponse, not the payer reference");
  }

  @Test
  void applyResolution_skipsStoreWhenNothingCorrelatesTrackingId() {
    FakeStore store = new FakeStore();

    ClaimResponse cr = new ClaimResponse();
    cr.addIdentifier().setValue("trk-9");
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
    cr.setPatient(new Reference("Patient/1822"));

    new PasResolutionService().applyResolution(cr, store);

    assertNull(store.upserted, "A decision no local Task or ClaimResponse correlates must not be stored");
    assertTrue(store.updatedTasks.isEmpty());
  }

  @Test
  void applyResolution_ignoresClaimResponseWithoutTrackingIdentifier() {
    FakeStore store = new FakeStore();

    ClaimResponse cr = new ClaimResponse();
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);

    new PasResolutionService().applyResolution(cr, store);

    assertNull(store.upserted);
    assertTrue(store.updatedTasks.isEmpty());
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
  void applyResolution_keepsPendedCompleteResponseInProgress() {
    FakeStore store = new FakeStore();
    Task task = new Task();
    task.addIdentifier().setValue("trk-2");
    store.tasks.add(task);

    ClaimResponse cr = claimResponseWithReviewAction("A4");
    cr.getIdentifier().clear();
    cr.addIdentifier().setValue("trk-2");

    new PasResolutionService().applyResolution(cr, store);

    assertEquals("in-progress", store.updatedTasks.get(0).getStatus().toCode());
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
