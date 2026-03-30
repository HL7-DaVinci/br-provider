package org.hl7.davinci.api;

import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.hl7.davinci.security.B2BTokenService;
import org.hl7.davinci.security.OutboundTargetValidator;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * BFF proxy for DTR operations against payer FHIR servers.
 * Authenticates to the payer using B2B client_credentials and relays
 * $questionnaire-package and $next-question operations.
 *
 * @see <a href="https://build.fhir.org/ig/HL7/davinci-dtr/en/specification.html">DTR Specification</a>
 */
@RestController
@RequestMapping("/api/dtr")
public class DtrProxyController {

    private static final Logger logger = LoggerFactory.getLogger(DtrProxyController.class);
    private static final List<String> DTR_SCOPES = ProxyUtil.DTR_SCOPES;

    private final B2BTokenService b2bTokenService;
    private final SecurityProperties securityProperties;
    private final OutboundTargetValidator outboundTargetValidator;
    private final ObjectMapper objectMapper;

    public DtrProxyController(
            B2BTokenService b2bTokenService,
            SecurityProperties securityProperties,
            OutboundTargetValidator outboundTargetValidator,
            ObjectMapper objectMapper) {
        this.b2bTokenService = b2bTokenService;
        this.securityProperties = securityProperties;
        this.outboundTargetValidator = outboundTargetValidator;
        this.objectMapper = objectMapper;
    }

    /**
     * Relays a $questionnaire-package request to the payer's FHIR server.
     * The frontend builds the FHIR Parameters body per the DTR spec; this
     * endpoint only adds B2B auth and forwards.
     *
     * Request body:
     * {
     *   "payerFhirUrl": "http://localhost:8081/fhir",
     *   "body": { "resourceType": "Parameters", "parameter": [...] }
     * }
     */
    @PostMapping("/questionnaire-package")
    public ResponseEntity<?> getQuestionnairePackage(@RequestBody Map<String, Object> params) {
        try {
            String payerFhirUrl = ProxyUtil.getRequiredParam(params, "payerFhirUrl");
            outboundTargetValidator.validate(UrlMatchUtil.normalizeUrl(payerFhirUrl));

            String operationUrl = UrlMatchUtil.normalizeUrl(payerFhirUrl) + "/Questionnaire/$questionnaire-package";

            Object body = params.get("body");
            if (body == null) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "body is required"));
            }
            String requestBody = objectMapper.writeValueAsString(body);

            return relayToPayerFhir(operationUrl, payerFhirUrl, requestBody);

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("DTR questionnaire-package error: {}", e.getMessage());
            return ResponseEntity.status(502)
                .body(Map.of("error", "Failed to fetch questionnaire package from payer"));
        }
    }

    /**
     * Relays a $next-question request to the payer's FHIR server
     * for adaptive questionnaires.
     *
     * Request body:
     * {
     *   "payerFhirUrl": "http://localhost:8081/fhir",
     *   "questionnaireResponse": { ... FHIR QuestionnaireResponse resource ... }
     * }
     */
    @PostMapping("/next-question")
    public ResponseEntity<?> nextQuestion(@RequestBody Map<String, Object> params) {
        try {
            String payerFhirUrl = ProxyUtil.getRequiredParam(params, "payerFhirUrl");
            outboundTargetValidator.validate(UrlMatchUtil.normalizeUrl(payerFhirUrl));

            String operationUrl = UrlMatchUtil.normalizeUrl(payerFhirUrl)
                + "/Questionnaire/$next-question";

            Object qr = params.get("questionnaireResponse");
            if (qr == null) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "questionnaireResponse is required"));
            }

            String requestBody = objectMapper.writeValueAsString(qr);

            return relayToPayerFhir(operationUrl, payerFhirUrl, requestBody);

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("DTR next-question error: {}", e.getMessage());
            return ResponseEntity.status(502)
                .body(Map.of("error", "Failed to fetch next question from payer"));
        }
    }

    private ResponseEntity<String> relayToPayerFhir(
            String operationUrl, String payerFhirUrl, String requestBody) throws Exception {
        return ProxyUtil.relayPostToPayerFhir(
            operationUrl, payerFhirUrl, requestBody,
            DTR_SCOPES, b2bTokenService, securityProperties, logger);
    }

}
