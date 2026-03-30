package org.hl7.davinci.api;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.UUID;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.B2BTokenService;
import org.hl7.davinci.security.CertificateHolder;
import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SecurityUtil;
import org.hl7.davinci.security.SpaAuthController;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * BFF proxy for PAS (Prior Authorization Support) operations against payer FHIR servers.
 * Reads referenced resources from the active provider FHIR server, builds a PAS request bundle,
 * authenticates to the payer using B2B client_credentials, and relays
 * Claim/$submit and Claim/$inquiry operations.
 *
 * @see <a href="https://build.fhir.org/ig/HL7/davinci-pas/en/specification.html">PAS Specification</a>
 */
@RestController
@RequestMapping("/api/pas")
public class PasProxyController {

    private static final Logger logger = LoggerFactory.getLogger(PasProxyController.class);
    private static final List<String> PAS_SCOPES = ProxyUtil.PAS_SCOPES;
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final B2BTokenService b2bTokenService;
    private final SecurityProperties securityProperties;
    private final ServerProperties serverProperties;
    private final CertificateHolder certificateHolder;
    private final OutboundTargetValidator outboundTargetValidator;
    private final ObjectMapper objectMapper;

    public PasProxyController(
            B2BTokenService b2bTokenService,
            SecurityProperties securityProperties,
            ServerProperties serverProperties,
            CertificateHolder certificateHolder,
            OutboundTargetValidator outboundTargetValidator,
            ObjectMapper objectMapper) {
        this.b2bTokenService = b2bTokenService;
        this.securityProperties = securityProperties;
        this.serverProperties = serverProperties;
        this.certificateHolder = certificateHolder;
        this.outboundTargetValidator = outboundTargetValidator;
        this.objectMapper = objectMapper;
    }

    /**
     * Submits a prior authorization request to a payer's Claim/$submit endpoint.
     *
     * Reads all referenced resources from the active provider FHIR server, builds a PAS
     * request bundle (Claim + supporting resources), and POSTs it to the payer.
     *
     * Request body:
     * {
     *   "patientId": "123",
     *   "orderId": "456",
     *   "orderType": "ServiceRequest",
     *   "coverageId": "789",
     *   "questionnaireResponseIds": ["qr1", "qr2"],
     *   "payerFhirUrl": "http://localhost:8081/fhir"
     * }
     */
    @PostMapping("/submit")
    public ResponseEntity<?> submit(
            @RequestBody Map<String, Object> params,
            HttpServletRequest request) {
        try {
            SubmitResources resources = readSubmitResources(params, request);
            String payerFhirUrl = ProxyUtil.getRequiredParam(params, "payerFhirUrl");

            Map<String, Object> bundle = buildPasBundle(
                resources.patient, resources.practitioner, resources.insurer,
                resources.coverage, resources.order, resources.orderType,
                resources.questionnaireResponses);

            String bundleJson = objectMapper.writeValueAsString(bundle);
            logger.info("PAS submit: sending bundle with {} entries to {}",
                ((List<?>) bundle.get("entry")).size(), payerFhirUrl);

            String submitUrl = UrlMatchUtil.normalizeUrl(payerFhirUrl) + "/Claim/$submit";
            return relayToPayerFhir(submitUrl, payerFhirUrl, bundleJson);

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("PAS submit error: {}", e.getMessage(), e);
            return ResponseEntity.status(502)
                .body(Map.of("error", "Failed to submit prior authorization to payer"));
        }
    }

    /**
     * Submits a PAS update request after additional documentation has been provided.
     * Builds a Claim with a `related` element referencing the prior Claim so the payer
     * detects this as an UPDATE rather than an INITIAL submission.
     *
     * Request body extends submit with:
     * {
     *   "priorClaimId": "claim-123"
     * }
     */
    @PostMapping("/update")
    public ResponseEntity<?> update(
            @RequestBody Map<String, Object> params,
            HttpServletRequest request) {
        try {
            SubmitResources resources = readSubmitResources(params, request);
            String payerFhirUrl = ProxyUtil.getRequiredParam(params, "payerFhirUrl");
            String priorClaimId = ProxyUtil.getRequiredParam(params, "priorClaimId");

            Map<String, Object> bundle = buildPasUpdateBundle(
                resources.patient, resources.practitioner, resources.insurer,
                resources.coverage, resources.order, resources.orderType,
                resources.questionnaireResponses, priorClaimId, payerFhirUrl);

            String bundleJson = objectMapper.writeValueAsString(bundle);
            logger.info("PAS update: sending bundle with {} entries to {} (priorClaim={})",
                ((List<?>) bundle.get("entry")).size(), payerFhirUrl, priorClaimId);

            String submitUrl = UrlMatchUtil.normalizeUrl(payerFhirUrl) + "/Claim/$submit";
            return relayToPayerFhir(submitUrl, payerFhirUrl, bundleJson);

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("PAS update error: {}", e.getMessage(), e);
            return ResponseEntity.status(502)
                .body(Map.of("error", "Failed to submit prior authorization update to payer"));
        }
    }

    /**
     * Checks the status of a pended prior authorization.
     *
     * When patientId + coverageId are provided, builds a proper PAS Inquiry Request
     * Bundle per the PAS IG and POSTs to Claim/$inquire. Otherwise falls back to a
     * simple GET /ClaimResponse/{id} for backward compatibility.
     *
     * Request body:
     * {
     *   "claimResponseId": "cr-123",
     *   "payerFhirUrl": "http://localhost:8081/fhir",
     *   "patientId": "pat015",        // optional, enables proper $inquire
     *   "orderId": "1234",            // optional
     *   "orderType": "ServiceRequest", // optional
     *   "coverageId": "cov015"        // optional, enables proper $inquire
     * }
     */
    @PostMapping("/inquiry")
    public ResponseEntity<?> inquiry(
            @RequestBody Map<String, Object> params,
            HttpServletRequest request) {
        try {
            String claimResponseId = ProxyUtil.getRequiredParam(params, "claimResponseId");
            String payerFhirUrl = ProxyUtil.getRequiredParam(params, "payerFhirUrl");
            outboundTargetValidator.validate(UrlMatchUtil.normalizeUrl(payerFhirUrl));

            String patientId = (String) params.get("patientId");
            String coverageId = (String) params.get("coverageId");

            // When full context is available, use proper Claim/$inquire per PAS IG
            if (patientId != null && coverageId != null) {
                return performInquire(params, request, payerFhirUrl);
            }

            // Fallback: simple GET /ClaimResponse/{id}
            String readUrl = UrlMatchUtil.normalizeUrl(payerFhirUrl)
                + "/ClaimResponse/" + claimResponseId;
            return relayGetToPayerFhir(readUrl, payerFhirUrl);

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("PAS inquiry error: {}", e.getMessage(), e);
            return ResponseEntity.status(502)
                .body(Map.of("error", "Failed to check prior authorization status"));
        }
    }

    /**
     * Builds a PAS Inquiry Request Bundle and POSTs to Claim/$inquire.
     * The bundle contains a Claim (profile-claim-inquiry) with patient, insurer,
     * provider, and coverage references, enabling query-by-example matching.
     */
    private ResponseEntity<?> performInquire(
            Map<String, Object> params,
            HttpServletRequest request,
            String payerFhirUrl) throws Exception {
        String patientId = ProxyUtil.getRequiredParam(params, "patientId");
        String coverageId = ProxyUtil.getRequiredParam(params, "coverageId");
        String orderType = (String) params.getOrDefault("orderType", "ServiceRequest");
        String orderId = (String) params.get("orderId");

        HttpSession session = request.getSession(false);
        validateRequestedProviderTarget(
            ProxyUtil.getRequestedProviderFhirBase(request), session);
        String providerFhirBase = ProxyUtil.getActiveProviderFhirBase(request, serverProperties);

        Map<String, Object> patient = readProviderResource(
            providerFhirBase, "Patient", patientId, session);
        Map<String, Object> coverage = readProviderResource(
            providerFhirBase, "Coverage", coverageId, session);
        Map<String, Object> insurer = readInsurerFromCoverage(
            providerFhirBase, coverage, session);

        Map<String, Object> practitioner = null;
        if (orderId != null) {
            Map<String, Object> order = readProviderResource(
                providerFhirBase, orderType, orderId, session);
            practitioner = readPractitionerFromOrder(providerFhirBase, order, session);
        }
        if (practitioner == null) {
            practitioner = Map.of("resourceType", "Practitioner", "id", "unknown");
        }

        Map<String, Object> inquiryBundle = buildInquiryBundle(
            patient, practitioner, insurer, coverage);

        String bundleJson = objectMapper.writeValueAsString(inquiryBundle);
        logger.info("PAS $inquire: sending inquiry bundle to {}", payerFhirUrl);

        String inquireUrl = UrlMatchUtil.normalizeUrl(payerFhirUrl) + "/Claim/$inquire";
        return relayToPayerFhir(inquireUrl, payerFhirUrl, bundleJson);
    }

    /**
     * Builds a PAS Inquiry Request Bundle per the PAS IG profile-pas-inquiry-request-bundle.
     * Contains a Claim (profile-claim-inquiry) with query-by-example references.
     */
    private Map<String, Object> buildInquiryBundle(
            Map<String, Object> patient,
            Map<String, Object> practitioner,
            Map<String, Object> insurer,
            Map<String, Object> coverage) {

        String patientRef = "Patient/" + patient.get("id");
        String practitionerRef = "Practitioner/" + practitioner.get("id");
        String insurerRef = "Organization/" + insurer.get("id");
        String coverageRef = "Coverage/" + coverage.get("id");

        Map<String, Object> claim = new LinkedHashMap<>();
        claim.put("resourceType", "Claim");
        claim.put("identifier", List.of(Map.of(
            "system", "http://example.org/SUBMITTER_CLAIM_IDENTIFIER",
            "value", java.util.UUID.randomUUID().toString()
        )));
        claim.put("status", "active");
        claim.put("type", Map.of(
            "coding", List.of(Map.of(
                "system", "http://terminology.hl7.org/CodeSystem/claim-type",
                "code", "professional"
            ))
        ));
        claim.put("use", "preauthorization");
        claim.put("patient", Map.of("reference", patientRef));
        claim.put("created", java.time.LocalDate.now().toString());
        claim.put("provider", Map.of("reference", practitionerRef));
        claim.put("insurer", Map.of("reference", insurerRef));
        claim.put("priority", Map.of(
            "coding", List.of(Map.of(
                "system", "http://terminology.hl7.org/CodeSystem/processpriority",
                "code", "normal"
            ))
        ));
        claim.put("insurance", List.of(Map.of(
            "sequence", 1,
            "focal", true,
            "coverage", Map.of("reference", coverageRef)
        )));
        // Wildcard item to match any service
        claim.put("item", List.of(Map.of(
            "sequence", 1,
            "productOrService", Map.of(
                "coding", List.of(Map.of(
                    "system", "http://terminology.hl7.org/CodeSystem/data-absent-reason",
                    "code", "not-applicable"
                ))
            )
        )));

        ensureMemberIdentifier(patient, coverage);

        List<Map<String, Object>> entries = new ArrayList<>();
        entries.add(bundleEntry(claim));
        entries.add(bundleEntry(patient));
        entries.add(bundleEntry(practitioner));
        entries.add(bundleEntry(insurer));
        entries.add(bundleEntry(coverage));

        Map<String, Object> bundle = new LinkedHashMap<>();
        bundle.put("resourceType", "Bundle");
        bundle.put("identifier", Map.of(
            "system", "urn:ietf:rfc:3986",
            "value", "urn:uuid:" + java.util.UUID.randomUUID()
        ));
        bundle.put("type", "collection");
        bundle.put("timestamp", java.time.Instant.now().toString());
        bundle.put("entry", entries);

        return bundle;
    }

    /**
     * Ensures the Patient has a member identifier (type=MB) derived from the
     * Coverage's subscriberId. PAS payers require this for inquiry matching.
     */
    @SuppressWarnings("unchecked")
    private void ensureMemberIdentifier(Map<String, Object> patient, Map<String, Object> coverage) {
        String subscriberId = (String) coverage.get("subscriberId");
        if (subscriberId == null) return;

        List<Map<String, Object>> identifiers = (List<Map<String, Object>>) patient.get("identifier");
        if (identifiers == null) {
            identifiers = new ArrayList<>();
            patient.put("identifier", identifiers);
        }

        boolean hasMB = identifiers.stream().anyMatch(id -> {
            Map<String, Object> type = (Map<String, Object>) id.get("type");
            if (type == null) return false;
            List<Map<String, Object>> codings = (List<Map<String, Object>>) type.get("coding");
            if (codings == null) return false;
            return codings.stream().anyMatch(c -> "MB".equals(c.get("code")));
        });

        if (!hasMB) {
            identifiers.add(Map.of(
                "type", Map.of(
                    "coding", List.of(Map.of(
                        "system", "http://terminology.hl7.org/CodeSystem/v2-0203",
                        "code", "MB",
                        "display", "Member Number"
                    ))
                ),
                "system", "http://example.org/MIN",
                "value", subscriberId
            ));
        }
    }

    // -- Shared resource reading for submit and update ----------------------------

    private record SubmitResources(
            Map<String, Object> patient,
            Map<String, Object> practitioner,
            Map<String, Object> insurer,
            Map<String, Object> coverage,
            Map<String, Object> order,
            String orderType,
            List<Map<String, Object>> questionnaireResponses) {}

    private SubmitResources readSubmitResources(Map<String, Object> params, HttpServletRequest request)
            throws Exception {
        String patientId = ProxyUtil.getRequiredParam(params, "patientId");
        String orderId = ProxyUtil.getRequiredParam(params, "orderId");
        String orderType = ProxyUtil.getRequiredParam(params, "orderType");
        String coverageId = ProxyUtil.getRequiredParam(params, "coverageId");
        String payerFhirUrl = ProxyUtil.getRequiredParam(params, "payerFhirUrl");

        @SuppressWarnings("unchecked")
        List<String> qrIds = (List<String>) params.getOrDefault(
            "questionnaireResponseIds", List.of());

        outboundTargetValidator.validate(UrlMatchUtil.normalizeUrl(payerFhirUrl));
        HttpSession session = request.getSession(false);
        validateRequestedProviderTarget(
            ProxyUtil.getRequestedProviderFhirBase(request), session);

        String providerFhirBase = ProxyUtil.getActiveProviderFhirBase(request, serverProperties);

        Map<String, Object> patient = readProviderResource(
            providerFhirBase, "Patient", patientId, session);
        Map<String, Object> order = readProviderResource(
            providerFhirBase, orderType, orderId, session);
        Map<String, Object> coverage = readProviderResource(
            providerFhirBase, "Coverage", coverageId, session);
        Map<String, Object> practitioner = readPractitionerFromOrder(
            providerFhirBase, order, session);
        Map<String, Object> insurer = readInsurerFromCoverage(
            providerFhirBase, coverage, session);

        List<Map<String, Object>> questionnaireResponses = new ArrayList<>();
        for (String qrId : qrIds) {
            questionnaireResponses.add(readProviderResource(
                providerFhirBase, "QuestionnaireResponse", qrId, session));
        }

        return new SubmitResources(patient, practitioner, insurer, coverage, order, orderType, questionnaireResponses);
    }

    /**
     * Builds a PAS Update bundle. Identical to an initial bundle except the Claim
     * has a `related` element referencing the prior Claim, which the payer uses
     * to detect this as an UPDATE submission.
     */
    private Map<String, Object> buildPasUpdateBundle(
            Map<String, Object> patient,
            Map<String, Object> practitioner,
            Map<String, Object> insurer,
            Map<String, Object> coverage,
            Map<String, Object> order,
            String orderType,
            List<Map<String, Object>> questionnaireResponses,
            String priorClaimId,
            String payerFhirUrl) {

        Map<String, Object> bundle = buildPasBundle(
            patient, practitioner, insurer, coverage, order, orderType,
            questionnaireResponses);

        // Add Claim.related to mark this as an UPDATE
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> entries = (List<Map<String, Object>>) bundle.get("entry");
        if (!entries.isEmpty()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> claimResource = (Map<String, Object>) entries.get(0).get("resource");
            String claimRef = UrlMatchUtil.normalizeUrl(payerFhirUrl) + "/Claim/" + priorClaimId;
            claimResource.put("related", List.of(Map.of(
                "claim", Map.of("reference", claimRef),
                "relationship", Map.of(
                    "coding", List.of(Map.of(
                        "system", "http://terminology.hl7.org/CodeSystem/ex-relatedclaimrelationship",
                        "code", "prior"
                    ))
                )
            )));
        }

        return bundle;
    }

    /**
     * Reads a FHIR resource from the active provider FHIR server.
     * Local reads use the bypass header; external provider reads reuse the
     * authenticated session token for the selected provider when one exists,
     * otherwise they fall back to anonymous reads for public servers.
     */
    private Map<String, Object> readProviderResource(
            String providerFhirBase,
            String resourceType,
            String id,
            HttpSession session)
            throws Exception {
        String url = UrlMatchUtil.normalizeUrl(providerFhirBase) + "/" + resourceType + "/" + id;

        HttpClient client = SecurityUtil.getHttpClient(securityProperties);
        HttpRequest.Builder request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("Accept", "application/fhir+json")
            .timeout(Duration.ofSeconds(10))
            .GET();

        if (UrlMatchUtil.matchesBaseUrl(url, serverProperties.getLocalServerAddress())) {
            request.header(securityProperties.getBypassHeader(), "1");
        } else {
            SpaAuthController.refreshTokenIfNeeded(session, securityProperties, certificateHolder);
            String accessToken = SpaAuthController.getTokenForServer(session, url);
            if (accessToken != null) {
                request.header("Authorization", "Bearer " + accessToken);
            }
        }

        HttpResponse<String> response = client.send(
            request.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalArgumentException(
                resourceType + "/" + id + " not found (HTTP " + response.statusCode() + ")");
        }

        return objectMapper.readValue(response.body(), MAP_TYPE);
    }

    /**
     * Extracts and reads the Practitioner from an order's requester reference.
     * Returns a minimal placeholder if no requester is set.
     */
    private Map<String, Object> readPractitionerFromOrder(
            String providerFhirBase,
            Map<String, Object> order,
            HttpSession session)
            throws Exception {
        @SuppressWarnings("unchecked")
        Map<String, Object> requester = (Map<String, Object>) order.get("requester");
        if (requester != null) {
            String ref = (String) requester.get("reference");
            if (ref != null && ref.startsWith("Practitioner/")) {
                String practId = ref.substring("Practitioner/".length());
                return readProviderResource(providerFhirBase, "Practitioner", practId, session);
            }
        }
        // Fallback: return a minimal Practitioner placeholder
        return Map.of("resourceType", "Practitioner", "id", "unknown");
    }

    /**
     * Extracts and reads the insurer Organization from a Coverage's payor reference.
     * Returns a minimal placeholder if no payor is set.
     */
    private Map<String, Object> readInsurerFromCoverage(
            String providerFhirBase,
            Map<String, Object> coverage,
            HttpSession session)
            throws Exception {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> payors = (List<Map<String, Object>>) coverage.get("payor");
        if (payors != null && !payors.isEmpty()) {
            String ref = (String) payors.get(0).get("reference");
            if (ref != null && ref.startsWith("Organization/")) {
                String orgId = ref.substring("Organization/".length());
                return readProviderResource(providerFhirBase, "Organization", orgId, session);
            }
        }
        return Map.of("resourceType", "Organization", "id", "unknown");
    }

    /**
     * Builds the PAS request bundle per the PAS IG specification.
     * Bundle type is "collection" with a Claim as the first entry followed
     * by all supporting resources.
     */
    private Map<String, Object> buildPasBundle(
            Map<String, Object> patient,
            Map<String, Object> practitioner,
            Map<String, Object> insurer,
            Map<String, Object> coverage,
            Map<String, Object> order,
            String orderType,
            List<Map<String, Object>> questionnaireResponses) {

        String patientRef = "Patient/" + patient.get("id");
        String practitionerRef = "Practitioner/" + practitioner.get("id");
        String insurerRef = "Organization/" + insurer.get("id");
        String coverageRef = "Coverage/" + coverage.get("id");

        Map<String, Object> claim = new LinkedHashMap<>();
        claim.put("resourceType", "Claim");
        claim.put("status", "active");
        claim.put("type", Map.of(
            "coding", List.of(Map.of(
                "system", "http://terminology.hl7.org/CodeSystem/claim-type",
                "code", "professional"
            ))
        ));
        claim.put("use", "preauthorization");
        claim.put("patient", Map.of("reference", patientRef));
        claim.put("created", LocalDate.now().toString());
        claim.put("provider", Map.of("reference", practitionerRef));
        claim.put("insurer", Map.of("reference", insurerRef));
        claim.put("priority", Map.of(
            "coding", List.of(Map.of(
                "system", "http://terminology.hl7.org/CodeSystem/processpriority",
                "code", "normal"
            ))
        ));

        claim.put("insurance", List.of(Map.of(
            "sequence", 1,
            "focal", true,
            "coverage", Map.of("reference", coverageRef)
        )));

        claim.put("item", List.of(buildClaimItem(order, orderType)));

        if (!questionnaireResponses.isEmpty()) {
            List<Map<String, Object>> supportingInfo = new ArrayList<>();
            for (int i = 0; i < questionnaireResponses.size(); i++) {
                Map<String, Object> qr = questionnaireResponses.get(i);
                supportingInfo.add(Map.of(
                    "sequence", i + 1,
                    "category", Map.of(
                        "coding", List.of(Map.of(
                            "system", "http://hl7.org/us/davinci-pas/CodeSystem/PASSupportingInfoType",
                            "code", "questionnaire"
                        ))
                    ),
                    "valueReference", Map.of(
                        "reference", "QuestionnaireResponse/" + qr.get("id")
                    )
                ));
            }
            claim.put("supportingInfo", supportingInfo);
        }

        List<Map<String, Object>> entries = new ArrayList<>();
        entries.add(bundleEntry(claim));
        entries.add(bundleEntry(patient));
        entries.add(bundleEntry(practitioner));
        entries.add(bundleEntry(insurer));
        entries.add(bundleEntry(coverage));
        entries.add(bundleEntry(order));
        for (Map<String, Object> qr : questionnaireResponses) {
            entries.add(bundleEntry(qr));
        }

        Map<String, Object> bundle = new LinkedHashMap<>();
        bundle.put("resourceType", "Bundle");
        bundle.put("identifier", Map.of(
            "system", "http://example.org/SUBMITTER_TRANSACTION_IDENTIFIER",
            "value", UUID.randomUUID().toString()
        ));
        bundle.put("type", "collection");
        bundle.put("timestamp", Instant.now().toString());
        bundle.put("entry", entries);

        return bundle;
    }

    /**
     * Builds a Claim.item from the order resource, extracting the primary code.
     */
    private Map<String, Object> buildClaimItem(Map<String, Object> order, String orderType) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("sequence", 1);

        Object code = extractOrderCode(order, orderType);
        if (code != null) {
            item.put("productOrService", code);
        } else {
            item.put("productOrService", Map.of(
                "coding", List.of(Map.of(
                    "system", "http://terminology.hl7.org/CodeSystem/data-absent-reason",
                    "code", "unknown"
                ))
            ));
        }

        return item;
    }

    /**
     * Extracts the primary CodeableConcept from an order resource.
     * Each order type stores its code in a different field.
     */
    private Object extractOrderCode(Map<String, Object> order, String orderType) {
        return switch (orderType) {
            case "MedicationRequest" -> {
                // medicationCodeableConcept
                Object medCode = order.get("medicationCodeableConcept");
                if (medCode != null) yield medCode;
                // Fall back to medicationReference
                yield order.get("medicationReference");
            }
            case "ServiceRequest" -> order.get("code");
            case "DeviceRequest" -> order.get("codeCodeableConcept");
            case "NutritionOrder" -> {
                // No single code; use a generic nutrition code
                @SuppressWarnings("unchecked")
                Map<String, Object> oralDiet = (Map<String, Object>) order.get("oralDiet");
                if (oralDiet != null) {
                    @SuppressWarnings("unchecked")
                    List<Object> types = (List<Object>) oralDiet.get("type");
                    if (types != null && !types.isEmpty()) yield types.get(0);
                }
                yield null;
            }
            case "VisionPrescription" -> {
                // Use the first lensSpecification product code if available
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> lensSpecs =
                    (List<Map<String, Object>>) order.get("lensSpecification");
                if (lensSpecs != null && !lensSpecs.isEmpty()) {
                    yield lensSpecs.get(0).get("product");
                }
                yield null;
            }
            case "CommunicationRequest" -> {
                @SuppressWarnings("unchecked")
                List<Object> categories = (List<Object>) order.get("category");
                if (categories != null && !categories.isEmpty()) yield categories.get(0);
                yield null;
            }
            default -> null;
        };
    }

    private Map<String, Object> bundleEntry(Map<String, Object> resource) {
        return Map.of(
            "fullUrl", "urn:uuid:" + UUID.randomUUID(),
            "resource", resource
        );
    }

    private ResponseEntity<String> relayToPayerFhir(
            String operationUrl, String payerFhirUrl, String requestBody) throws Exception {
        return ProxyUtil.relayPostToPayerFhir(
            operationUrl, payerFhirUrl, requestBody,
            PAS_SCOPES, b2bTokenService, securityProperties, logger);
    }

    private ResponseEntity<String> relayGetToPayerFhir(
            String url, String payerFhirUrl) throws Exception {
        return ProxyUtil.relayGetToPayerFhir(
            url, payerFhirUrl, PAS_SCOPES,
            b2bTokenService, securityProperties, logger);
    }

    private void validateRequestedProviderTarget(
            String requestedProviderFhirBase,
            HttpSession session) {
        if (requestedProviderFhirBase == null || requestedProviderFhirBase.isBlank()) {
            return;
        }

        String normalizedRequested = UrlMatchUtil.normalizeUrl(requestedProviderFhirBase);
        if (matchesKnownProvider(normalizedRequested, session)) {
            return;
        }

        outboundTargetValidator.validate(normalizedRequested);
    }

    private boolean matchesKnownProvider(String targetUrl, HttpSession session) {
        if (UrlMatchUtil.matchesBaseUrl(targetUrl, serverProperties.getLocalServerAddress())) {
            return true;
        }

        for (String trustedProviderUrl : serverProperties.getTrustedProviderUrls()) {
            if (UrlMatchUtil.matchesBaseUrl(targetUrl, trustedProviderUrl)) {
                return true;
            }
        }

        if (session != null) {
            String sessionServer = (String) session.getAttribute(SpaAuthController.SESSION_SERVER_URL);
            if (sessionServer != null
                    && UrlMatchUtil.matchesBaseUrl(targetUrl, UrlMatchUtil.normalizeUrl(sessionServer))) {
                return true;
            }
        }

        return false;
    }

}
