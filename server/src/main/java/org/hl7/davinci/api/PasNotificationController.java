package org.hl7.davinci.api;

import java.util.UUID;

import org.hl7.davinci.pas.PasResolutionService;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import ca.uhn.fhir.context.FhirContext;

/**
 * Inbound endpoint for PAS Subscription rest-hook notifications from the payer. When the payer
 * finalizes a pended prior authorization it POSTs a notification Bundle here (a SubscriptionStatus
 * Parameters in entry[0] plus the PAS response bundle with the resolved ClaimResponse). The resolved
 * ClaimResponse is applied to the provider's local store, correlated to the originating order through
 * the provider-minted Task (Task.identifier = the tracking identifier), so the order list reflects the
 * decision without the SPA polling.
 *
 * @see <a href="https://build.fhir.org/ig/HL7/davinci-pas/en/specification.html#pended-authorization-responses">
 *   PAS: Pended Authorization Responses (subscriptions SHALL be supported)</a>
 */
@RestController
@RequestMapping("/api/pas/notification")
public class PasNotificationController {

  private static final Logger log = LoggerFactory.getLogger(PasNotificationController.class);
  private static final MediaType FHIR_JSON = MediaType.valueOf("application/fhir+json");
  private static final String OK_BUNDLE =
      "{\"resourceType\":\"Bundle\",\"type\":\"transaction-response\",\"entry\":[]}";

  private final PasResolutionService resolutionService;
  private final FhirContext fhirContext;
  private final ObjectMapper objectMapper;
  private final DevActivityController devActivity;
  private final JsonNode okBundleNode;

  public PasNotificationController(PasResolutionService resolutionService, FhirContext fhirContext,
      ObjectMapper objectMapper, DevActivityController devActivity) {
    this.resolutionService = resolutionService;
    this.fhirContext = fhirContext;
    this.objectMapper = objectMapper;
    this.devActivity = devActivity;
    try {
      this.okBundleNode = objectMapper.readTree(OK_BUNDLE);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @PostMapping(consumes = "application/fhir+json", produces = "application/fhir+json")
  public ResponseEntity<String> receive(@RequestBody String body) {
    // Unauthenticated webhook: production must verify the caller (channel.header bearer, mTLS, or an
    // IP allowlist) before acting on a notification.
    JsonNode bodyNode = null;
    JsonNode claimResponseNode = null;
    try {
      bodyNode = objectMapper.readTree(body);
      claimResponseNode = findClaimResponse(bodyNode);
      if (claimResponseNode != null) {
        ClaimResponse claimResponse = fhirContext.newJsonParser()
            .parseResource(ClaimResponse.class, claimResponseNode.toString());
        resolutionService.applyResolution(claimResponse);
      }
      // handshake / heartbeat notifications carry no ClaimResponse; acknowledge with 200.
    } catch (Exception e) {
      log.warn("Failed to process PAS notification", e);
    }
    boolean decision = claimResponseNode != null;
    devActivity.record(new DevActivityController.ActivityEvent(
        UUID.randomUUID().toString(), System.currentTimeMillis(), "inbound", "POST",
        "/api/pas/notification", 200,
        decision ? "PAS Notification (decision)" : "PAS Notification",
        decision ? "pas-decision" : "subscription-event",
        bodyNode, okBundleNode));
    return ResponseEntity.ok().contentType(FHIR_JSON).body(OK_BUNDLE);
  }

  private JsonNode findClaimResponse(JsonNode bundle) {
    JsonNode entries = bundle.path("entry");
    if (entries.isArray()) {
      for (JsonNode entry : entries) {
        JsonNode resource = entry.path("resource");
        if ("ClaimResponse".equals(resource.path("resourceType").asText())) {
          return resource;
        }
        // The R4-backport notification nests the PAS Response Bundle (with the ClaimResponse) as an
        // entry resource alongside the SubscriptionStatus, so recurse into nested Bundles.
        if ("Bundle".equals(resource.path("resourceType").asText())) {
          JsonNode nested = findClaimResponse(resource);
          if (nested != null) {
            return nested;
          }
        }
      }
    }
    return null;
  }
}
