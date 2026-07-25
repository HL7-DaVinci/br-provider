package org.hl7.davinci.api;

import java.util.List;
import java.util.UUID;

import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.pas.LocalPasResolutionStore;
import org.hl7.davinci.pas.PasResolutionService;
import org.hl7.davinci.pas.PasResolutionStore;
import org.hl7.davinci.pas.RemotePasResolutionStore;
import org.hl7.davinci.security.B2BTokenService;
import org.hl7.davinci.security.OutboundAuthService;
import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.util.UrlMatchUtil;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.client.interceptor.BearerTokenAuthInterceptor;

/**
 * Inbound endpoint for PAS Subscription rest-hook notifications from the payer. When the payer
 * finalizes a pended prior authorization it POSTs a notification Bundle here (a SubscriptionStatus
 * Parameters in entry[0] plus the PAS response bundle with the resolved ClaimResponse). The resolved
 * ClaimResponse is applied to a {@link PasResolutionStore}, correlated to the originating order through
 * the provider-minted Task (Task.identifier = the tracking identifier), so the order list reflects the
 * decision without the SPA polling.
 *
 * <p>The optional {@code ehr} query parameter selects which EHR's store receives the resolution
 * (the order may have originated from an external EHR rather than this server). Because this webhook
 * is unauthenticated, {@code ehr} is attacker-controllable and names a write target, so it is treated
 * as untrusted input. An absent value, or one matching this server's own address, resolves to the
 * local store. A value that (after {@link UrlMatchUtil} normalization) matches the statically
 * configured {@code app.provider-servers} allowlist
 * ({@link ServerProperties#getTrustedProviderUrls()}) is trusted outright. Any other value must pass
 * {@link org.hl7.davinci.security.OutboundTargetValidator} SSRF checks, or the decision is rejected
 * with a 422 response and never written anywhere. B2B bearer tokens are only minted for allowlisted
 * targets; a validator-accepted target outside the allowlist is written to with a tokenless client.
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
  private static final List<String> EHR_WRITEBACK_SCOPES =
      List.of("system/Task.rus", "system/ClaimResponse.cus");

  private final PasResolutionService resolutionService;
  private final LocalPasResolutionStore localStore;
  private final FhirContext fhirContext;
  private final ObjectMapper objectMapper;
  private final DevActivityController devActivity;
  private final ServerProperties serverProperties;
  private final B2BTokenService b2bTokenService;
  private final OutboundAuthService outboundAuth;
  private final OutboundTargetValidator targetValidator;
  private final JsonNode okBundleNode;

  public PasNotificationController(PasResolutionService resolutionService, LocalPasResolutionStore localStore,
      FhirContext fhirContext, ObjectMapper objectMapper, DevActivityController devActivity,
      ServerProperties serverProperties, B2BTokenService b2bTokenService, OutboundAuthService outboundAuth,
      OutboundTargetValidator targetValidator) {
    this.resolutionService = resolutionService;
    this.localStore = localStore;
    this.fhirContext = fhirContext;
    this.objectMapper = objectMapper;
    this.devActivity = devActivity;
    this.serverProperties = serverProperties;
    this.b2bTokenService = b2bTokenService;
    this.outboundAuth = outboundAuth;
    this.targetValidator = targetValidator;
    try {
      this.okBundleNode = objectMapper.readTree(OK_BUNDLE);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @PostMapping(consumes = "application/fhir+json", produces = "application/fhir+json")
  public ResponseEntity<String> receive(@RequestBody String body,
      @RequestParam(name = "ehr", required = false) String ehr) {
    // Unauthenticated webhook: production must verify the caller (channel.header bearer, mTLS, or an
    // IP allowlist) before acting on a notification.
    JsonNode bodyNode;
    try {
      bodyNode = objectMapper.readTree(body);
    } catch (Exception e) {
      log.warn("Failed to parse PAS notification body", e);
      return acknowledgeSubscriptionEvent(null);
    }

    JsonNode claimResponseNode = findClaimResponse(bodyNode);
    if (claimResponseNode == null) {
      // handshake / heartbeat notifications carry no ClaimResponse; acknowledge with 200.
      return acknowledgeSubscriptionEvent(bodyNode);
    }

    ClaimResponse claimResponse;
    try {
      claimResponse = fhirContext.newJsonParser()
          .parseResource(ClaimResponse.class, claimResponseNode.toString());
    } catch (Exception e) {
      log.warn("PAS notification carried an unparseable ClaimResponse", e);
      return errorResponse(bodyNode, 400, "processing",
          "The notification's ClaimResponse could not be parsed.");
    }

    PasResolutionStore store;
    try {
      store = resolveStore(ehr);
    } catch (UntrustedEhrException e) {
      log.warn("PAS notification: ehr {} not in trusted provider list; decision rejected", e.getEhr());
      return errorResponse(bodyNode, 422, "forbidden",
          "The ehr '" + e.getEhr() + "' is not in the trusted provider list; the decision was not written.");
    }

    try {
      resolutionService.applyResolution(claimResponse, store);
    } catch (Exception e) {
      log.error("Failed to apply PAS decision to target EHR {}", ehr, e);
      return errorResponse(bodyNode, 502, "processing",
          "Failed to apply the decision to the target EHR.");
    }

    devActivity.record(new DevActivityController.ActivityEvent(
        UUID.randomUUID().toString(), System.currentTimeMillis(), "inbound", "POST",
        "/api/pas/notification", 200, "PAS Notification (decision)", "pas-decision",
        bodyNode, okBundleNode));
    return ResponseEntity.ok().contentType(FHIR_JSON).body(OK_BUNDLE);
  }

  private ResponseEntity<String> acknowledgeSubscriptionEvent(JsonNode bodyNode) {
    devActivity.record(new DevActivityController.ActivityEvent(
        UUID.randomUUID().toString(), System.currentTimeMillis(), "inbound", "POST",
        "/api/pas/notification", 200, "PAS Notification", "subscription-event",
        bodyNode, okBundleNode));
    return ResponseEntity.ok().contentType(FHIR_JSON).body(OK_BUNDLE);
  }

  private ResponseEntity<String> errorResponse(JsonNode bodyNode, int status, String issueCode,
      String diagnostics) {
    JsonNode outcomeNode = operationOutcomeNode(issueCode, diagnostics);
    devActivity.record(new DevActivityController.ActivityEvent(
        UUID.randomUUID().toString(), System.currentTimeMillis(), "inbound", "POST",
        "/api/pas/notification", status, "PAS Notification (decision)", "pas-decision-error",
        bodyNode, outcomeNode));
    return ResponseEntity.status(status).contentType(FHIR_JSON).body(outcomeNode.toString());
  }

  private JsonNode operationOutcomeNode(String issueCode, String diagnostics) {
    ObjectNode outcome = objectMapper.createObjectNode();
    outcome.put("resourceType", "OperationOutcome");
    ArrayNode issues = outcome.putArray("issue");
    ObjectNode issue = issues.addObject();
    issue.put("severity", "error");
    issue.put("code", issueCode);
    issue.put("diagnostics", diagnostics);
    return outcome;
  }

  /**
   * Selects the store the resolved ClaimResponse is applied to. See the class javadoc for the
   * trust rule this enforces: an untrusted {@code ehr} throws {@link UntrustedEhrException} rather
   * than reaching a remote client build or falling back to the local store.
   */
  private PasResolutionStore resolveStore(String ehr) {
    if (ehr == null || ehr.isBlank()
        || UrlMatchUtil.matchesBaseUrl(ehr, serverProperties.getLocalServerAddress())) {
      return localStore;
    }
    String normalized = UrlMatchUtil.normalizeUrl(ehr);
    boolean allowlisted = serverProperties.getTrustedProviderUrls().contains(normalized);
    if (!allowlisted) {
      try {
        targetValidator.validate(normalized);
      } catch (IllegalArgumentException e) {
        throw new UntrustedEhrException(ehr);
      }
    }
    IGenericClient client = fhirContext.newRestfulGenericClient(normalized);
    if (allowlisted && outboundAuth.modeFor(normalized) != OutboundAuthService.Mode.OPEN) {
      String token = b2bTokenService.getTokenForServer(normalized, EHR_WRITEBACK_SCOPES);
      if (token != null) {
        client.registerInterceptor(new BearerTokenAuthInterceptor(token));
      }
    }
    return new RemotePasResolutionStore(client);
  }

  /** Signals that the {@code ehr} query parameter did not match the trusted provider allowlist. */
  private static final class UntrustedEhrException extends RuntimeException {
    private final String ehr;

    UntrustedEhrException(String ehr) {
      super("PAS notification ehr '" + ehr + "' is not in the trusted provider list");
      this.ehr = ehr;
    }

    String getEhr() {
      return ehr;
    }
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
