package org.hl7.davinci.pas;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
  void applyResolution_blanksUnresolvedReferences() {
    DaoRegistry daoRegistry = mock(DaoRegistry.class);
    IFhirResourceDao crDao = mock(IFhirResourceDao.class);
    IFhirResourceDao taskDao = mock(IFhirResourceDao.class);
    IFhirResourceDao claimDao = mock(IFhirResourceDao.class);
    IFhirResourceDao patientDao = mock(IFhirResourceDao.class);
    when(daoRegistry.getResourceDao("ClaimResponse")).thenReturn(crDao);
    when(daoRegistry.getResourceDao("Task")).thenReturn(taskDao);
    when(daoRegistry.getResourceDao("Claim")).thenReturn(claimDao);
    when(daoRegistry.getResourceDao("Patient")).thenReturn(patientDao);
    when(claimDao.read(any(), any())).thenThrow(new RuntimeException("not found"));
    DaoMethodOutcome crOutcome = new DaoMethodOutcome();
    crOutcome.setId(new IdType("ClaimResponse", "cr-1"));
    when(crDao.update(any(), anyString(), any(RequestDetails.class))).thenReturn(crOutcome);
    when(taskDao.search(any(), any())).thenReturn(new SimpleBundleProvider());

    ClaimResponse cr = new ClaimResponse();
    cr.addIdentifier().setValue("trk-1");
    cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
    cr.setRequest(new Reference("Claim/1821"));
    cr.setPatient(new Reference("Patient/pat014"));

    new PasResolutionService(daoRegistry).applyResolution(cr);

    ArgumentCaptor<ClaimResponse> captor = ArgumentCaptor.forClass(ClaimResponse.class);
    verify(crDao).update(captor.capture(), anyString(), any(RequestDetails.class));
    ClaimResponse stored = captor.getValue();
    assertNull(stored.getRequest().getReference());
    assertEquals("Patient/pat014", stored.getPatient().getReference());
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
}
