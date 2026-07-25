package org.hl7.davinci.pas;

import java.util.List;

import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Extension;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Task;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Applies a resolved PAS ClaimResponse to a caller-supplied {@link PasResolutionStore}. The
 * ClaimResponse is the IG-native carrier of the prior-authorization decision; the provider-minted
 * Task (Task.focus = the order) is the durable correlation.
 */
@Component
public class PasResolutionService {

  private static final Logger log = LoggerFactory.getLogger(PasResolutionService.class);

  // Serialized because the payer may deliver the same decision through several subscriptions at
  // once; concurrent identical conditional updates fail on version conflicts at the target EHR.
  // ponytail: global lock, per-tracking-id locks if notification volume matters
  public synchronized void applyResolution(ClaimResponse claimResponse, PasResolutionStore store) {
    String trackingId = claimResponse.getIdentifierFirstRep().getValue();
    if (trackingId == null || trackingId.isBlank()) {
      log.warn("PAS notification: ClaimResponse carries no tracking identifier; ignoring");
      return;
    }
    List<Task> tasks = store.findTasksByIdentifier(trackingId);
    ClaimResponse existing = store.findClaimResponseByIdentifier(trackingId);
    if (tasks.isEmpty() && existing == null) {
      log.info("PAS notification: tracking id {} matches no Task or ClaimResponse in this store; "
          + "decision not stored", trackingId);
      return;
    }
    blankPayerReferences(claimResponse);
    adoptPatientFromTask(claimResponse, tasks);
    adoptLocalReferences(claimResponse, existing);
    String claimResponseId = store.upsertClaimResponse(claimResponse, trackingId);
    updateTasks(store, tasks, claimResponse, claimResponseId, trackingId);
  }

  /**
   * Blanks the literal references on the payer's ClaimResponse. They carry payer-side
   * logical ids that have no meaning in this store, so keeping any of them would either
   * fail referential integrity or silently point at an unrelated local resource.
   */
  private void blankPayerReferences(ClaimResponse cr) {
    blankReference(cr.hasRequest() ? cr.getRequest() : null);
    blankReference(cr.hasRequestor() ? cr.getRequestor() : null);
    blankReference(cr.hasInsurer() ? cr.getInsurer() : null);
    blankReference(cr.hasPatient() ? cr.getPatient() : null);
    for (ClaimResponse.InsuranceComponent insurance : cr.getInsurance()) {
      blankReference(insurance.hasCoverage() ? insurance.getCoverage() : null);
    }
    for (Reference communicationRequest : cr.getCommunicationRequest()) {
      blankReference(communicationRequest);
    }
  }

  private void blankReference(Reference ref) {
    if (ref != null && ref.hasReference()) {
      ref.setReference(null);
    }
  }

  /**
   * Points ClaimResponse.patient at this provider's Patient, taken from the correlated
   * Task's Task.for, so local patient-scoped queries find the stored decision.
   */
  private void adoptPatientFromTask(ClaimResponse claimResponse, List<Task> tasks) {
    for (Task task : tasks) {
      if (task.hasFor() && task.getFor().hasReference()) {
        claimResponse.setPatient(new Reference(task.getFor().getReference()));
        return;
      }
    }
  }

  /**
   * Rewrites the required references (patient, insurer) from the store's already-persisted copy
   * of this ClaimResponse. Blanking alone drops these 1..1 elements, and servers that validate
   * writes (unlike HAPI's default) reject the resource.
   */
  private void adoptLocalReferences(ClaimResponse claimResponse, ClaimResponse existing) {
    if (existing == null) {
      return;
    }
    if (!claimResponse.getPatient().hasReference() && existing.getPatient().hasReference()) {
      claimResponse.setPatient(existing.getPatient().copy());
    }
    if (!claimResponse.getInsurer().hasReference() && existing.getInsurer().hasReference()) {
      claimResponse.setInsurer(existing.getInsurer().copy());
    }
  }

  private void updateTasks(PasResolutionStore store, List<Task> tasks, ClaimResponse claimResponse,
      String claimResponseId, String trackingId) {
    if (tasks.isEmpty()) {
      log.info("PAS notification: no Task found for tracking id {}; ClaimResponse stored only", trackingId);
      return;
    }
    String status = isPended(claimResponse) ? "in-progress" : mapOutcomeToTaskStatus(claimResponse.getOutcome());
    for (Task task : tasks) {
      if (status != null) {
        task.setStatus(Task.TaskStatus.fromCode(status));
      }
      setClaimResponseOutput(task, claimResponseId);
      store.updateTask(task);
    }
    log.info("PAS notification: updated {} Task(s) for tracking id {} -> {}", tasks.size(), trackingId, status);
  }

  private void setClaimResponseOutput(Task task, String claimResponseId) {
    task.getOutput().removeIf(out -> out.getType() != null
        && "ClaimResponse".equals(out.getType().getText()));
    task.addOutput()
        .setType(new CodeableConcept().setText("ClaimResponse"))
        .setValue(new Reference("ClaimResponse/" + claimResponseId));
  }

  static String mapOutcomeToTaskStatus(ClaimResponse.RemittanceOutcome outcome) {
    if (outcome == null) {
      return null;
    }
    return switch (outcome) {
      case COMPLETE -> "completed";
      case ERROR -> "failed";
      case QUEUED, PARTIAL -> "in-progress";
      default -> null;
    };
  }

  private static final String REVIEW_ACTION_EXT =
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction";
  private static final String REVIEW_ACTION_CODE_EXT =
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewActionCode";
  private static final String X12_306_SYSTEM = "https://codesystem.x12.org/005010/306";
  private static final String REVIEW_ACTION_CODE_PEND = "A4";

  /**
   * True when a ClaimResponse represents a pended prior authorization: the profile-valid signal is
   * item.adjudication[].extension(reviewAction).extension(reviewActionCode) coding A4 from the X12
   * 306 codesystem; outcome=queued is tolerated as a legacy/transitional signal.
   */
  static boolean isPended(ClaimResponse claimResponse) {
    if (claimResponse.getOutcome() == ClaimResponse.RemittanceOutcome.QUEUED) {
      return true;
    }
    for (ClaimResponse.ItemComponent item : claimResponse.getItem()) {
      for (ClaimResponse.AdjudicationComponent adjudication : item.getAdjudication()) {
        for (Extension reviewAction : adjudication.getExtensionsByUrl(REVIEW_ACTION_EXT)) {
          for (Extension code : reviewAction.getExtensionsByUrl(REVIEW_ACTION_CODE_EXT)) {
            if (code.getValue() instanceof CodeableConcept concept) {
              for (Coding coding : concept.getCoding()) {
                if (X12_306_SYSTEM.equals(coding.getSystem())
                    && REVIEW_ACTION_CODE_PEND.equals(coding.getCode())) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
    return false;
  }
}
