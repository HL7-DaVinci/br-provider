package org.hl7.davinci.pas;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.Task;
import org.springframework.stereotype.Component;

import ca.uhn.fhir.jpa.api.dao.DaoRegistry;
import ca.uhn.fhir.jpa.api.dao.IFhirResourceDao;
import ca.uhn.fhir.jpa.searchparam.SearchParameterMap;
import ca.uhn.fhir.rest.api.server.IBundleProvider;
import ca.uhn.fhir.rest.api.server.SystemRequestDetails;
import ca.uhn.fhir.rest.param.ParameterUtil;
import ca.uhn.fhir.rest.param.TokenParam;

/**
 * {@link PasResolutionStore} backed by this provider's local HAPI FHIR store. Used by the inbound
 * Subscription notification path, which has no user session, so all store access uses
 * SystemRequestDetails.
 */
@Component
public class LocalPasResolutionStore implements PasResolutionStore {

  private final DaoRegistry daoRegistry;

  public LocalPasResolutionStore(DaoRegistry daoRegistry) {
    this.daoRegistry = daoRegistry;
  }

  @Override
  @SuppressWarnings("rawtypes")
  public List<Task> findTasksByIdentifier(String trackingId) {
    IFhirResourceDao dao = daoRegistry.getResourceDao("Task");
    SearchParameterMap params = new SearchParameterMap().add("identifier", new TokenParam(trackingId));
    IBundleProvider results = dao.search(params, new SystemRequestDetails());
    return results.getAllResources().stream()
        .filter(Task.class::isInstance)
        .map(Task.class::cast)
        .toList();
  }

  @Override
  public ClaimResponse findClaimResponseByIdentifier(String trackingId) {
    IFhirResourceDao<?> dao = daoRegistry.getResourceDao("ClaimResponse");
    SearchParameterMap params = new SearchParameterMap().add("identifier", new TokenParam(trackingId));
    IBundleProvider results = dao.search(params, new SystemRequestDetails());
    return results.getAllResources().stream()
        .filter(ClaimResponse.class::isInstance)
        .map(ClaimResponse.class::cast)
        .findFirst()
        .orElse(null);
  }

  @Override
  @SuppressWarnings({"rawtypes", "unchecked"})
  public String upsertClaimResponse(ClaimResponse claimResponse, String trackingId) {
    IFhirResourceDao dao = daoRegistry.getResourceDao("ClaimResponse");
    claimResponse.setId((String) null);
    // trackingId is attacker-controlled (unauthenticated webhook), so FHIR token delimiters
    // ($ , | \) must be backslash-escaped before URL-encoding; URL-encoding alone survives
    // MatchUrlService's percent-decode and still lets a bare comma/pipe redirect the match.
    String conditionalUrl = "ClaimResponse?identifier="
        + URLEncoder.encode(ParameterUtil.escape(trackingId), StandardCharsets.UTF_8);
    return dao.update(claimResponse, conditionalUrl, new SystemRequestDetails())
        .getId().getIdPart();
  }

  @Override
  @SuppressWarnings({"rawtypes", "unchecked"})
  public void updateTask(Task task) {
    daoRegistry.getResourceDao("Task").update(task, new SystemRequestDetails());
  }
}
