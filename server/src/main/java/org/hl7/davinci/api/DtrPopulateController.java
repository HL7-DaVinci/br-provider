package org.hl7.davinci.api;

import java.util.List;
import java.util.Map;

import org.hl7.davinci.security.B2BTokenService;
import org.hl7.davinci.security.LocalSystemTokenService;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.util.UrlMatchUtil;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Endpoint;
import org.hl7.fhir.r4.model.Parameters;
import org.hl7.fhir.r4.model.Questionnaire;
import org.hl7.fhir.r4.model.QuestionnaireResponse;
import org.hl7.fhir.r4.model.StringType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.client.interceptor.SimpleRequestHeaderInterceptor;

/**
 * BFF endpoint for DTR pre-population using HAPI CR's Questionnaire/$populate.
 * Builds FHIR Endpoint resources pointing to the content and terminology servers
 * derived from the $questionnaire-package bundle, so the CQL engine resolves
 * Libraries and ValueSets from their origin servers.
 *
 * @see <a href="https://build.fhir.org/ig/HL7/sdc/en/OperationDefinition-Questionnaire-populate.html">$populate</a>
 */
@RestController
@RequestMapping("/api/dtr")
public class DtrPopulateController {

    private static final Logger logger = LoggerFactory.getLogger(DtrPopulateController.class);
    private static final List<String> DTR_SCOPES = ProxyUtil.DTR_SCOPES;

    private final FhirContext fhirContext;
    private final B2BTokenService b2bTokenService;
    private final LocalSystemTokenService localSystemTokenService;
    private final SecurityProperties securityProperties;

    public DtrPopulateController(
            FhirContext fhirContext,
            B2BTokenService b2bTokenService,
            LocalSystemTokenService localSystemTokenService,
            SecurityProperties securityProperties) {
        this.fhirContext = fhirContext;
        this.b2bTokenService = b2bTokenService;
        this.localSystemTokenService = localSystemTokenService;
        this.securityProperties = securityProperties;
    }

    /**
     * Accepts an inline Questionnaire and delegates to Questionnaire/$populate,
     * pointing the CQL engine at the appropriate content and terminology servers
     * for Library and ValueSet resolution.
     */
    @PostMapping("/populate")
    public ResponseEntity<?> populate(@RequestBody String body) {
        try {
            var parsed = fhirContext.newJsonParser().parseResource(Parameters.class, body);

            Questionnaire questionnaire = null;
            String patientId = null;
            String contentServerUrl = null;
            String terminologyServerUrl = null;

            for (var param : parsed.getParameter()) {
                switch (param.getName()) {
                    case "questionnaire" -> {
                        if (param.getResource() instanceof Questionnaire q)
                            questionnaire = q;
                    }
                    case "patientId" -> {
                        if (param.getValue() instanceof StringType s)
                            patientId = s.getValue();
                    }
                    case "contentServerUrl" -> {
                        if (param.getValue() instanceof StringType s)
                            contentServerUrl = s.getValue();
                    }
                    case "terminologyServerUrl" -> {
                        if (param.getValue() instanceof StringType s)
                            terminologyServerUrl = s.getValue();
                    }
                }
            }

            if (questionnaire == null || patientId == null || contentServerUrl == null) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error",
                        "questionnaire, patientId, and contentServerUrl are required"));
            }

            if (terminologyServerUrl == null) {
                terminologyServerUrl = contentServerUrl;
            }

            // Build $populate input with inline Questionnaire and remote endpoints
            // for Library/ValueSet resolution
            Parameters populateInput = new Parameters();
            populateInput.addParameter().setName("questionnaire").setResource(questionnaire);
            populateInput.addParameter().setName("subject")
                .setValue(new StringType("Patient/" + patientId));
            populateInput.addParameter().setName("contentEndpoint")
                .setResource(buildEndpoint(contentServerUrl));
            populateInput.addParameter().setName("terminologyEndpoint")
                .setResource(buildEndpoint(terminologyServerUrl));

            String localFhirBase = securityProperties.getServerBaseUrl() + "/fhir";
            var client = fhirContext.newRestfulGenericClient(localFhirBase);
            String systemToken = localSystemTokenService.mintSystemToken(DTR_SCOPES);
            if (systemToken == null) {
                return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Internal authorization unavailable for $populate"));
            }
            client.registerInterceptor(
                new SimpleRequestHeaderInterceptor("Authorization", "Bearer " + systemToken));

            Parameters result = client.operation()
                .onType("Questionnaire")
                .named("$populate")
                .withParameters(populateInput)
                .execute();

            for (var param : result.getParameter()) {
                if (param.getResource() instanceof QuestionnaireResponse qr) {
                    String responseJson = fhirContext.newJsonParser().encodeResourceToString(qr);
                    return ResponseEntity.ok()
                        .header("Content-Type", "application/fhir+json")
                        .body(responseJson);
                }
            }

            return ResponseEntity.ok()
                .header("Content-Type", "application/fhir+json")
                .body(fhirContext.newJsonParser().encodeResourceToString(result));

        } catch (Exception e) {
            logger.error("Populate failed: {}", e.getMessage());
            return ResponseEntity.internalServerError()
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Builds a FHIR Endpoint resource for the given server URL.
     * Includes a B2B Bearer token in the headers when available.
     */
    private Endpoint buildEndpoint(String serverUrl) {
        String normalizedUrl = UrlMatchUtil.normalizeUrl(serverUrl);

        Endpoint endpoint = new Endpoint();
        endpoint.setStatus(Endpoint.EndpointStatus.ACTIVE);
        endpoint.setConnectionType(new Coding(
            "http://terminology.hl7.org/CodeSystem/endpoint-connection-type",
            "hl7-fhir-rest", null));
        endpoint.setAddress(normalizedUrl);

        String token = b2bTokenService.getTokenForServer(normalizedUrl, DTR_SCOPES);
        if (token != null) {
            endpoint.addHeader("Authorization: Bearer " + token);
        }

        return endpoint;
    }
}
