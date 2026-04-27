package org.hl7.davinci.api;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SmartLaunchService;
import org.hl7.davinci.security.SmartLaunchService.LaunchContext;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Creates SMART EHR launch contexts for DTR app launches.
 * The frontend calls this before opening the DTR route to establish
 * patient/encounter/order context.
 */
@RestController
@RequestMapping("/api/smart")
public class SmartLaunchController {

    private static final Logger logger = LoggerFactory.getLogger(SmartLaunchController.class);

    private final SmartLaunchService smartLaunchService;
    private final SecurityProperties securityProperties;

    public SmartLaunchController(
            SmartLaunchService smartLaunchService,
            SecurityProperties securityProperties) {
        this.smartLaunchService = smartLaunchService;
        this.securityProperties = securityProperties;
    }

    /**
     * Creates a SMART launch context and returns the launch token and URL.
     *
     * Request body:
     * {
     *   "patientId": "123",
     *   "encounterId": "456",           // optional
     *   "fhirContext": ["Coverage/789", "ServiceRequest/101"]  // optional
     * }
     *
     * Response:
     * {
     *   "launchToken": "uuid",
     *   "launchUrl": "/dtr/launch?iss=http://localhost:8080/fhir&launch=uuid"
     * }
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/launch")
    public ResponseEntity<?> createLaunch(@RequestBody Map<String, Object> body) {
        String patientId = (String) body.get("patientId");
        if (patientId == null || patientId.isBlank()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "patientId is required"));
        }

        String encounterId = (String) body.get("encounterId");
        String coverageAssertionId = (String) body.get("coverageAssertionId");
        String requestedProviderFhirUrl = (String) body.get("providerFhirUrl");

        List<String> fhirContext = null;
        Object fhirContextObj = body.get("fhirContext");
        if (fhirContextObj instanceof List<?> list) {
            fhirContext = (List<String>) (List<?>) list;
        }

        List<String> questionnaire = null;
        Object questionnaireObj = body.get("questionnaire");
        if (questionnaireObj instanceof List<?> qList) {
            questionnaire = (List<String>) (List<?>) qList;
        } else if (questionnaireObj instanceof String qs) {
            questionnaire = List.of(qs);
        }

        String appContext = (String) body.get("appContext");

        String launchToken = smartLaunchService.createLaunchContext(
            patientId, encounterId, fhirContext, coverageAssertionId, questionnaire, appContext);

        String providerFhirUrl = resolveProviderFhirUrl(requestedProviderFhirUrl);
        String appLaunchUrl = (String) body.get("appLaunchUrl");
        String launchUrl = buildLaunchUrl(appLaunchUrl, providerFhirUrl, launchToken);

        logger.debug("SMART launch context created: token={}, patient={}", launchToken, patientId);

        return ResponseEntity.ok(Map.of(
            "launchToken", launchToken,
            "launchUrl", launchUrl
        ));
    }

    /**
     * Returns and consumes a previously created launch context.
     * The token is single-use and expires after 5 minutes.
     */
    @GetMapping("/context")
    public ResponseEntity<?> getLaunchContext(@RequestParam("launch") String launchToken) {
        LaunchContext ctx = smartLaunchService.consumeLaunchContext(launchToken);
        if (ctx == null) {
            return ResponseEntity.notFound().build();
        }
        Map<String, Object> response = new HashMap<>();
        response.put("patientId", ctx.patientId());
        response.put("encounterId", ctx.encounterId());
        response.put("fhirContext", ctx.fhirContextReferences());
        response.put("coverageAssertionId", ctx.coverageAssertionId());
        response.put("questionnaire", ctx.questionnaire());
        if (ctx.appContext() != null) {
            response.put("appContext", ctx.appContext());
        }
        return ResponseEntity.ok(response);
    }

    private String resolveProviderFhirUrl(String requestedProviderFhirUrl) {
        if (requestedProviderFhirUrl != null && !requestedProviderFhirUrl.isBlank()) {
            return UrlMatchUtil.normalizeUrl(requestedProviderFhirUrl);
        }
        return securityProperties.getSmartFhirBaseUrl();
    }

    private static String buildLaunchUrl(String appLaunchUrl, String providerFhirUrl, String launchToken) {
        String encodedIss = URLEncoder.encode(providerFhirUrl, StandardCharsets.UTF_8);
        String encodedLaunch = URLEncoder.encode(launchToken, StandardCharsets.UTF_8);
        if (appLaunchUrl == null || appLaunchUrl.isBlank()) {
            return "/dtr/launch?iss=" + encodedIss + "&launch=" + encodedLaunch;
        }

        String separator = appLaunchUrl.contains("?") ? "&" : "?";
        return appLaunchUrl + separator + "iss=" + encodedIss + "&launch=" + encodedLaunch;
    }
}
