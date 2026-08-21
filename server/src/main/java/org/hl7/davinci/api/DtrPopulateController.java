package org.hl7.davinci.api;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.SessionTokenService;
import org.hl7.davinci.util.DtrPackageNormalizer;
import org.hl7.davinci.util.ForwardedHeaderUtil;
import org.hl7.davinci.util.UrlMatchUtil;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.OperationOutcome;
import org.hl7.fhir.r4.model.OperationOutcome.IssueSeverity;
import org.hl7.fhir.r4.model.OperationOutcome.IssueType;
import org.hl7.fhir.r4.model.Parameters;
import org.hl7.fhir.r4.model.Parameters.ParametersParameterComponent;
import org.hl7.fhir.r4.model.Questionnaire;
import org.hl7.fhir.r4.model.QuestionnaireResponse;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.Resource;
import org.hl7.fhir.r4.model.StringType;
import org.opencds.cqf.fhir.cql.EvaluationSettings;
import org.opencds.cqf.fhir.cql.LibraryEngine;
import org.opencds.cqf.fhir.cr.CrSettings;
import org.opencds.cqf.fhir.cr.questionnaire.QuestionnaireProcessor;
import org.opencds.cqf.fhir.utility.repository.InMemoryFhirRepository;
import org.opencds.cqf.fhir.utility.repository.Repositories;
import org.opencds.cqf.fhir.utility.repository.RestRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.repository.IRepository;
import ca.uhn.fhir.rest.api.server.IRepositoryFactory;
import ca.uhn.fhir.rest.api.server.SystemRequestDetails;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.client.interceptor.BearerTokenAuthInterceptor;
import ca.uhn.fhir.rest.client.interceptor.SimpleRequestHeaderInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

/**
 * DTR pre-population endpoint for the SPA. This is a BFF operation, not a
 * conformant SDC $populate: it borrows the SDC body shape (subject,
 * context) but adds a `packagebundle` parameter that carries the payer's
 * supporting artifacts (Libraries, ValueSets, CodeSystems) from the prior
 * $questionnaire-package response, so the engine never has to re-fetch
 * them at evaluation time.
 *
 * Internally it invokes cqf-fhir's {@link QuestionnaireProcessor}
 * in-process. The package bundle is wrapped in an
 * {@link InMemoryFhirRepository} that serves as both content source
 * (Library / StructureDefinition lookups) and terminology source
 * (ValueSet / CodeSystem lookups). Patient and clinical retrieves are
 * routed to the active provider FHIR server resolved from the session
 * (set by the OAuth callback or by `POST /auth/active-server`): the
 * local JPA repository when the active base is this server, or a
 * {@link RestRepository} carrying the user's session bearer token
 * otherwise.
 *
 * Body shape (FHIR Parameters):
 *   - subject         : Reference to Patient (target subject of the QR)
 *   - questionnaire   : Resource (the Questionnaire to populate)
 *   - context         : repeated launchContext bindings (name + content parts)
 *   - packagebundle   : Resource (Bundle from the payer's $questionnaire-package)
 */
@RestController
@RequestMapping("/api/dtr")
public class DtrPopulateController {

    private static final Logger logger = LoggerFactory.getLogger(DtrPopulateController.class);

    private final FhirContext fhirContext;
    private final IRepositoryFactory repositoryFactory;
    private final EvaluationSettings evaluationSettings;
    private final ServerProperties serverProperties;
    private final SessionTokenService sessionTokens;

    public DtrPopulateController(
            FhirContext fhirContext,
            IRepositoryFactory repositoryFactory,
            EvaluationSettings evaluationSettings,
            ServerProperties serverProperties,
            SessionTokenService sessionTokens) {
        this.fhirContext = fhirContext;
        this.repositoryFactory = repositoryFactory;
        this.evaluationSettings = evaluationSettings;
        this.serverProperties = serverProperties;
        this.sessionTokens = sessionTokens;
    }

    @PostMapping(value = "/populate", consumes = "application/fhir+json", produces = "application/fhir+json")
    public ResponseEntity<String> populate(@RequestBody String body, HttpServletRequest request) {
        Parameters input;
        try {
            input = (Parameters) fhirContext.newJsonParser().parseResource(body);
        } catch (Exception e) {
            return errorOutcome(IssueType.STRUCTURE, "Request body is not a FHIR Parameters resource: " + e.getMessage());
        }

        Bundle packageBundle = extractResource(input, "packagebundle", Bundle.class);
        if (packageBundle == null) {
            return errorOutcome(IssueType.INVALID,
                "Missing required 'packagebundle' parameter (Bundle resource from $questionnaire-package)");
        }

        Questionnaire questionnaire = extractResource(input, "questionnaire", Questionnaire.class);
        if (questionnaire == null) {
            return errorOutcome(IssueType.INVALID,
                "Missing required 'questionnaire' parameter (embedded Questionnaire resource)");
        }

        String subject = extractReference(input, "subject");
        if (subject == null) {
            return errorOutcome(IssueType.INVALID,
                "Missing required 'subject' parameter (Reference to Patient)");
        }

        List<ParametersParameterComponent> contexts = input.getParameter().stream()
            .filter(p -> "context".equals(p.getName()))
            .toList();

        try {
            DtrPackageNormalizer.alignLibrariesWithCql(packageBundle, questionnaire);

            // Wrap the payer package bundle as an in-memory repository.
            // Passed as both content (Library/StructureDefinition) and
            // terminology (ValueSet/CodeSystem) source of the proxied repository.
            InMemoryFhirRepository inMemoryRepo = new InMemoryFhirRepository(fhirContext, packageBundle);

            // Patient/clinical retrieves come from the session's active provider
            // FHIR server: local JPA when the active base is this server,
            // RestRepository carrying the user's session bearer token otherwise.
            IRepository dataRepo = resolveDataRepository(request);

            Map<String, Resource> orderParameters = resolveOrderParameters(contexts, dataRepo);
            IRepository proxied = Repositories.proxy(dataRepo, true, null, inMemoryRepo, inMemoryRepo);
            DtrPopulateRequest populateRequest = new DtrPopulateRequest(questionnaire, subject, contexts,
                new LibraryEngine(proxied, evaluationSettings), orderParameters);
            CrSettings crSettings = new CrSettings().withEvaluationSettings(evaluationSettings);
            QuestionnaireResponse result = (QuestionnaireResponse) new QuestionnaireProcessor(dataRepo, crSettings)
                .populate(populateRequest);

            if (logger.isDebugEnabled()) {
                long answered = result.getItem().stream()
                    .filter(item -> item.hasAnswer() || item.hasItem())
                    .count();
                logger.debug("Populate for subject {} produced {} top-level items ({} with content), {} contained",
                    subject, result.getItem().size(), answered, result.getContained().size());
            }

            return ResponseEntity.ok()
                .header("Content-Type", "application/fhir+json")
                .body(fhirContext.newJsonParser().encodeResourceToString(result));
        } catch (Exception e) {
            logger.error("Populate failed", e);
            return errorOutcome(IssueType.EXCEPTION, e.getMessage());
        }
    }

    /**
     * Resolves the FHIR data repository for the current session. Returns the
     * local JPA repository when the active provider base is this server (no
     * HTTP hop, transactional reads). Otherwise builds a {@link RestRepository}
     * pointed at the active base, attaching the user's SMART session bearer
     * token when present.
     *
     * Uses the user's authorization_code session token from
     * {@link SessionTokenService#SESSION_ACCESS_TOKEN}; never the B2B
     * client_credentials token (DTR populate is a client action on behalf of
     * a logged-in user).
     *
     * Package-private so {@code DtrPopulateControllerTest} can exercise the
     * branching directly without standing up a full populate call.
     */
    IRepository resolveDataRepository(HttpServletRequest request) {
        String activeBase = ProxyUtil.getActiveProviderFhirBase(request, serverProperties);
        if (UrlMatchUtil.matchesBaseUrl(activeBase, serverProperties.getLocalServerAddress())) {
            logger.debug("Populate retrieves use the local JPA repository (active base {})", activeBase);
            return repositoryFactory.create(new SystemRequestDetails());
        }
        HttpSession session = request != null ? request.getSession(false) : null;
        sessionTokens.refreshTokenIfNeeded(session);
        String token = sessionTokens.getTokenForServer(session, activeBase);
        logger.debug("Populate retrieves use REST base {} (session token {})",
            activeBase, token != null ? "present" : "absent");
        IGenericClient client = fhirContext.newRestfulGenericClient(activeBase);
        var forwarded = ForwardedHeaderUtil.extract(request);
        if (token != null && !forwarded.hasAuthorization()) {
            client.registerInterceptor(new BearerTokenAuthInterceptor(token));
        }
        forwarded.headers().forEach((name, value) ->
            client.registerInterceptor(new SimpleRequestHeaderInterceptor(name, value)));
        return new RestRepository(client);
    }

    /**
     * Reads the order named by a {@code device_request}, {@code service_request}
     * or {@code medication_request} context so it can be bound as a CQL
     * parameter. Inline resources are used as-is, references are read from the
     * data repository. A failed read is logged and skipped so the rest of the
     * questionnaire still populates.
     */
    Map<String, Resource> resolveOrderParameters(List<ParametersParameterComponent> contexts, IRepository dataRepo) {
        Map<String, Resource> parameters = new HashMap<>();
        for (ParametersParameterComponent context : contexts) {
            String name = context.getPart().stream()
                .filter(p -> "name".equals(p.getName()) && p.getValue() instanceof StringType)
                .map(p -> ((StringType) p.getValue()).getValue())
                .findFirst()
                .orElse(null);
            if (name == null || !DtrPopulateRequest.ORDER_PARAMETER_NAMES.contains(name)) {
                continue;
            }
            context.getPart().stream()
                .filter(p -> "content".equals(p.getName()))
                .map(p -> p.hasResource() ? p.getResource() : readReference(p, dataRepo))
                .filter(Objects::nonNull)
                .findFirst()
                .ifPresent(order -> parameters.put(name, order));
        }
        return parameters;
    }

    private Resource readReference(ParametersParameterComponent content, IRepository dataRepo) {
        if (!(content.getValue() instanceof Reference reference) || !reference.hasReference()) {
            return null;
        }
        IdType id = new IdType(reference.getReference());
        try {
            Class<? extends IBaseResource> type = fhirContext.getResourceDefinition(id.getResourceType())
                .getImplementingClass();
            return (Resource) dataRepo.read(type, id);
        } catch (Exception e) {
            logger.warn("Could not read order {} for CQL parameter binding: {}", id.getValue(), e.getMessage());
            return null;
        }
    }

    private <T extends Resource> T extractResource(Parameters input, String name, Class<T> type) {
        return input.getParameter().stream()
            .filter(p -> name.equals(p.getName()) && p.getResource() != null)
            .map(ParametersParameterComponent::getResource)
            .filter(type::isInstance)
            .map(type::cast)
            .findFirst()
            .orElse(null);
    }

    private String extractReference(Parameters input, String name) {
        return input.getParameter().stream()
            .filter(p -> name.equals(p.getName()) && p.getValue() instanceof Reference)
            .map(p -> ((Reference) p.getValue()).getReference())
            .filter(s -> s != null && !s.isEmpty())
            .findFirst()
            .orElse(null);
    }

    private ResponseEntity<String> errorOutcome(IssueType code, String diagnostics) {
        OperationOutcome outcome = new OperationOutcome();
        outcome.addIssue()
            .setSeverity(IssueSeverity.ERROR)
            .setCode(code)
            .setDiagnostics(diagnostics);
        return ResponseEntity.internalServerError()
            .header("Content-Type", "application/fhir+json")
            .body(fhirContext.newJsonParser().encodeResourceToString(outcome));
    }
}
