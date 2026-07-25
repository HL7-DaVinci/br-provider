package org.hl7.davinci.pas;

import java.util.List;

import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.Task;

import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.util.BundleUtil;

/**
 * {@link PasResolutionStore} backed by a remote FHIR server reached through a HAPI fluent
 * client. Not a Spring bean; constructed per-notification with a client configured for the
 * originating server (base URL and optional bearer token).
 */
public class RemotePasResolutionStore implements PasResolutionStore {

  private final IGenericClient client;

  public RemotePasResolutionStore(IGenericClient client) {
    this.client = client;
  }

  @Override
  public List<Task> findTasksByIdentifier(String trackingId) {
    Bundle bundle = client.search().forResource(Task.class)
        .where(Task.IDENTIFIER.exactly().code(trackingId))
        .returnBundle(Bundle.class)
        .execute();
    return BundleUtil.toListOfResourcesOfType(client.getFhirContext(), bundle, Task.class);
  }

  @Override
  public ClaimResponse findClaimResponseByIdentifier(String trackingId) {
    Bundle bundle = client.search().forResource(ClaimResponse.class)
        .where(ClaimResponse.IDENTIFIER.exactly().code(trackingId))
        .returnBundle(Bundle.class)
        .execute();
    return BundleUtil.toListOfResourcesOfType(client.getFhirContext(), bundle, ClaimResponse.class)
        .stream()
        .findFirst()
        .orElse(null);
  }

  @Override
  public String upsertClaimResponse(ClaimResponse claimResponse, String trackingId) {
    claimResponse.setId((String) null);
    return client.update().resource(claimResponse)
        .conditional().where(ClaimResponse.IDENTIFIER.exactly().code(trackingId))
        .execute().getId().getIdPart();
  }

  @Override
  public void updateTask(Task task) {
    client.update().resource(task).execute();
  }
}
