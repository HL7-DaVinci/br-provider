package org.hl7.davinci.pas;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.Task;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import ca.uhn.fhir.jpa.api.dao.DaoRegistry;
import ca.uhn.fhir.jpa.api.dao.IFhirResourceDao;
import ca.uhn.fhir.jpa.api.model.DaoMethodOutcome;
import ca.uhn.fhir.jpa.searchparam.SearchParameterMap;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.api.server.SystemRequestDetails;
import ca.uhn.fhir.rest.param.TokenParam;
import ca.uhn.fhir.rest.server.SimpleBundleProvider;

class LocalPasResolutionStoreTest {

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void findTasksByIdentifier_searchesTaskDaoByIdentifierToken() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao taskDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("Task")).thenReturn(taskDao);
    Task task = new Task();
    task.addIdentifier().setValue("track-1");
    when(taskDao.search(any(), any())).thenReturn(new SimpleBundleProvider(task));

    List<Task> found = new LocalPasResolutionStore(daoRegistry).findTasksByIdentifier("track-1");

    assertEquals(1, found.size());
    ArgumentCaptor<SearchParameterMap> paramsCaptor = ArgumentCaptor.forClass(SearchParameterMap.class);
    verify(taskDao).search(paramsCaptor.capture(), any(SystemRequestDetails.class));
    TokenParam identifierParam = (TokenParam) paramsCaptor.getValue().get("identifier").get(0).get(0);
    assertEquals("track-1", identifierParam.getValue());
  }

  @Test
  @SuppressWarnings("rawtypes")
  void findClaimResponseByIdentifier_searchesClaimResponseDaoByIdentifierToken() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao crDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("ClaimResponse")).thenReturn(crDao);
    ClaimResponse stored = new ClaimResponse();
    stored.setId("cr-1");
    when(crDao.search(any(), any())).thenReturn(new SimpleBundleProvider(stored));

    ClaimResponse found =
        new LocalPasResolutionStore(daoRegistry).findClaimResponseByIdentifier("track-1");

    assertEquals("cr-1", found.getIdElement().getIdPart());
    ArgumentCaptor<SearchParameterMap> paramsCaptor = ArgumentCaptor.forClass(SearchParameterMap.class);
    verify(crDao).search(paramsCaptor.capture(), any(SystemRequestDetails.class));
    TokenParam identifierParam = (TokenParam) paramsCaptor.getValue().get("identifier").get(0).get(0);
    assertEquals("track-1", identifierParam.getValue());
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void upsertClaimResponse_conditionallyUpdatesByTrackingIdentifier() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao crDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("ClaimResponse")).thenReturn(crDao);
    DaoMethodOutcome crOutcome = new DaoMethodOutcome();
    crOutcome.setId(new IdType("ClaimResponse", "cr-123"));
    when(crDao.update(any(), anyString(), any(RequestDetails.class))).thenReturn(crOutcome);

    ClaimResponse cr = new ClaimResponse();
    cr.addIdentifier().setValue("track-1");

    String id = new LocalPasResolutionStore(daoRegistry).upsertClaimResponse(cr, "track-1");

    assertEquals("cr-123", id);
    verify(crDao).update(eq(cr), contains("ClaimResponse?identifier=track-1"), any(RequestDetails.class));
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void upsertClaimResponse_escapesFhirTokenDelimitersBeforeUrlEncodingTrackingId() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao crDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("ClaimResponse")).thenReturn(crDao);
    DaoMethodOutcome crOutcome = new DaoMethodOutcome();
    crOutcome.setId(new IdType("ClaimResponse", "cr-456"));
    when(crDao.update(any(), anyString(), any(RequestDetails.class))).thenReturn(crOutcome);

    ClaimResponse cr = new ClaimResponse();
    String maliciousTrackingId = "trk,evil|x";
    cr.addIdentifier().setValue(maliciousTrackingId);

    new LocalPasResolutionStore(daoRegistry).upsertClaimResponse(cr, maliciousTrackingId);

    ArgumentCaptor<String> urlCaptor = ArgumentCaptor.forClass(String.class);
    verify(crDao).update(eq(cr), urlCaptor.capture(), any(RequestDetails.class));
    String conditionalUrl = urlCaptor.getValue();

    // The percent-encoded backslash must sit directly in front of the percent-encoded
    // comma/pipe, proving the delimiter was backslash-escaped before URL-encoding.
    assertTrue(
        conditionalUrl.contains("%5C%2C"), "comma must be backslash-escaped: " + conditionalUrl);
    assertTrue(
        conditionalUrl.contains("%5C%7C"), "pipe must be backslash-escaped: " + conditionalUrl);

    String identifierParam = conditionalUrl.substring(conditionalUrl.indexOf("identifier=") + "identifier=".length());
    String decoded = URLDecoder.decode(identifierParam, StandardCharsets.UTF_8);
    assertEquals("trk\\,evil\\|x", decoded);

    // Once backslash-escaped delimiters are stripped, no bare FHIR token delimiter should
    // remain; a bare comma/pipe would let MatchUrlService split the search value and widen
    // or redirect which ClaimResponse the conditional update matches.
    String withEscapesRemoved = decoded.replace("\\,", "").replace("\\|", "");
    assertFalse(withEscapesRemoved.contains(","), "unescaped comma leaked through: " + decoded);
    assertFalse(withEscapesRemoved.contains("|"), "unescaped pipe leaked through: " + decoded);
  }

  @Test
  @SuppressWarnings({"rawtypes", "unchecked"})
  void updateTask_updatesTaskDaoWithSystemRequestDetails() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao taskDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("Task")).thenReturn(taskDao);
    when(taskDao.update(any(), any(SystemRequestDetails.class))).thenReturn(new DaoMethodOutcome());

    Task task = new Task();
    new LocalPasResolutionStore(daoRegistry).updateTask(task);

    verify(taskDao).update(eq(task), any(SystemRequestDetails.class));
  }
}
