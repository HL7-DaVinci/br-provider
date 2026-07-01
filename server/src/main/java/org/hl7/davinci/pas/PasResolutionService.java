package org.hl7.davinci.pas;

import java.util.List;

import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Task;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import ca.uhn.fhir.jpa.api.dao.DaoRegistry;
import ca.uhn.fhir.jpa.api.dao.IFhirResourceDao;
import ca.uhn.fhir.jpa.searchparam.SearchParameterMap;
import ca.uhn.fhir.rest.api.server.IBundleProvider;
import ca.uhn.fhir.rest.api.server.SystemRequestDetails;
import ca.uhn.fhir.rest.param.TokenParam;

/**
 * Applies a resolved PAS ClaimResponse to the provider's local FHIR store. The ClaimResponse is the
 * IG-native carrier of the prior-authorization decision; the provider-minted Task (Task.focus = the
 * order) is the durable correlation. Used by the inbound Subscription notification path, which has no
 * user session, so all store access uses SystemRequestDetails.
 */
@Component
public class PasResolutionService {

  private static final Logger log = LoggerFactory.getLogger(PasResolutionService.class);

  private final DaoRegistry daoRegistry;

  public PasResolutionService(DaoRegistry daoRegistry) {
    this.daoRegistry = daoRegistry;
  }

  public void applyResolution(ClaimResponse claimResponse) {
    String trackingId = claimResponse.getIdentifierFirstRep().getValue();
    if (trackingId == null || trackingId.isBlank()) {
      log.warn("PAS notification: ClaimResponse carries no tracking identifier; ignoring");
      return;
    }
    String claimResponseId = upsertClaimResponse(claimResponse, trackingId);
    updateTasks(trackingId, claimResponse, claimResponseId);
  }

  @SuppressWarnings({"rawtypes", "unchecked"})
  private String upsertClaimResponse(ClaimResponse claimResponse, String trackingId) {
    IFhirResourceDao dao = daoRegistry.getResourceDao("ClaimResponse");
    blankUnresolvedReferences(claimResponse);
    claimResponse.setId((String) null);
    return dao.update(claimResponse, "ClaimResponse?identifier=" + trackingId, new SystemRequestDetails())
        .getId().getIdPart();
  }

  /**
   * Blanks literal references to resources not held locally so a cross-server reference (e.g. the
   * payer's Claim, which lives on the payer) does not fail referential integrity on the store.
   */
  private void blankUnresolvedReferences(ClaimResponse cr) {
    blankIfMissing(cr.hasRequest() ? cr.getRequest() : null);
    blankIfMissing(cr.hasRequestor() ? cr.getRequestor() : null);
    blankIfMissing(cr.hasInsurer() ? cr.getInsurer() : null);
    blankIfMissing(cr.hasPatient() ? cr.getPatient() : null);
    for (ClaimResponse.InsuranceComponent insurance : cr.getInsurance()) {
      blankIfMissing(insurance.hasCoverage() ? insurance.getCoverage() : null);
    }
  }

  @SuppressWarnings({"rawtypes", "unchecked"})
  private void blankIfMissing(Reference ref) {
    if (ref == null || !ref.hasReference() || !ref.getReference().matches("[A-Za-z]+/[A-Za-z0-9.-]+")) {
      return;
    }
    String[] parts = ref.getReference().split("/", 2);
    try {
      daoRegistry.getResourceDao(parts[0]).read(new IdType(parts[0], parts[1]), new SystemRequestDetails());
    } catch (RuntimeException e) {
      ref.setReference(null);
    }
  }

  @SuppressWarnings({"rawtypes", "unchecked"})
  private void updateTasks(String trackingId, ClaimResponse claimResponse, String claimResponseId) {
    IFhirResourceDao dao = daoRegistry.getResourceDao("Task");
    SearchParameterMap params = new SearchParameterMap().add("identifier", new TokenParam(trackingId));
    IBundleProvider results = dao.search(params, new SystemRequestDetails());
    List<IBaseResource> tasks = results.getAllResources();
    if (tasks.isEmpty()) {
      log.info("PAS notification: no Task found for tracking id {}; ClaimResponse stored only", trackingId);
      return;
    }
    String status = mapOutcomeToTaskStatus(claimResponse.getOutcome());
    for (IBaseResource resource : tasks) {
      Task task = (Task) resource;
      if (status != null) {
        task.setStatus(Task.TaskStatus.fromCode(status));
      }
      setClaimResponseOutput(task, claimResponseId);
      dao.update(task, new SystemRequestDetails());
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
}
