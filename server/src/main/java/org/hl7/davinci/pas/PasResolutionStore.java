package org.hl7.davinci.pas;

import java.util.List;

import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.Task;

/**
 * Storage backend for applying a resolved PAS ClaimResponse: finding the correlated Task(s) by
 * tracking identifier, persisting the ClaimResponse, and persisting Task updates. Implementations
 * decide where that storage lives (this provider's local FHIR store, a remote store, etc.);
 * {@link PasResolutionService} only orchestrates against this interface.
 */
public interface PasResolutionStore {

  List<Task> findTasksByIdentifier(String trackingId);

  /** The ClaimResponse already persisted for this tracking identifier, or null. */
  ClaimResponse findClaimResponseByIdentifier(String trackingId);

  String upsertClaimResponse(ClaimResponse claimResponse, String trackingId);

  void updateTask(Task task);
}
