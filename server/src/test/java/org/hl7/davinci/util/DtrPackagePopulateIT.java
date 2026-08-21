package org.hl7.davinci.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Map;
import java.util.Optional;

import org.hl7.davinci.api.DtrPopulateRequest;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.DeviceRequest;
import org.hl7.fhir.r4.model.DateType;
import org.hl7.fhir.r4.model.Enumerations.AdministrativeGender;
import org.hl7.fhir.r4.model.HumanName;
import org.hl7.fhir.r4.model.OperationOutcome;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Questionnaire;
import org.hl7.fhir.r4.model.QuestionnaireResponse;
import org.hl7.fhir.r4.model.QuestionnaireResponse.QuestionnaireResponseItemComponent;
import org.junit.jupiter.api.Test;
import org.cqframework.cql.cql2elm.CqlCompilerOptions.Options;
import org.opencds.cqf.fhir.cql.EvaluationSettings;
import org.opencds.cqf.fhir.cql.LibraryEngine;
import org.opencds.cqf.fhir.cr.CrSettings;
import org.opencds.cqf.fhir.cr.questionnaire.QuestionnaireProcessor;
import org.opencds.cqf.fhir.utility.repository.InMemoryFhirRepository;
import org.opencds.cqf.fhir.utility.repository.Repositories;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.repository.IRepository;

/**
 * Runs the real cqf populate engine against the Inferno DTR respiratory
 * assist device package, whose Library metadata disagrees with its CQL
 * headers. Without normalization every CQL expression fails to resolve.
 */
class DtrPackagePopulateIT {

    private static final FhirContext CTX = FhirContext.forR4Cached();

    private static Bundle loadPackage() throws Exception {
        try (InputStream in = DtrPackagePopulateIT.class.getResourceAsStream(
                "/dtr/respiratory-assist-device-package.json")) {
            return (Bundle) CTX.newJsonParser().parseResource(
                new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    private static Questionnaire questionnaireFrom(Bundle packageBundle) {
        return packageBundle.getEntry().stream()
            .map(Bundle.BundleEntryComponent::getResource)
            .filter(Questionnaire.class::isInstance)
            .map(Questionnaire.class::cast)
            .findFirst()
            .orElseThrow();
    }

    private static InMemoryFhirRepository patientRepository() {
        Patient patient = new Patient();
        patient.setId("Patient/pat015");
        patient.addName(new HumanName().setUse(HumanName.NameUse.OFFICIAL)
            .setFamily("Oster").addGiven("William").addGiven("Henry").addGiven("Oscar"));
        patient.setGender(AdministrativeGender.MALE);
        patient.setBirthDateElement(new DateType("2015-02-23"));
        InMemoryFhirRepository repo = new InMemoryFhirRepository(CTX);
        repo.update(patient);
        return repo;
    }

    private static DeviceRequest deviceRequest() {
        DeviceRequest order = new DeviceRequest();
        order.setId("DeviceRequest/devreqe0470");
        order.setCode(new CodeableConcept().addCoding(new Coding()
            .setSystem("https://bluebutton.cms.gov/resources/codesystem/hcpcs")
            .setCode("E0470")
            .setDisplay("Respiratory assist device")));
        return order;
    }

    private static QuestionnaireResponse populate(boolean normalize) throws Exception {
        Bundle packageBundle = loadPackage();
        Questionnaire questionnaire = questionnaireFrom(packageBundle);
        if (normalize) {
            DtrPackageNormalizer.alignLibrariesWithCql(packageBundle, questionnaire);
        }
        InMemoryFhirRepository content = new InMemoryFhirRepository(CTX, packageBundle);
        // Mirrors the server's CR config, which leaves list demotion and promotion enabled.
        EvaluationSettings evaluationSettings = EvaluationSettings.getDefault();
        evaluationSettings.getCqlOptions().getCqlCompilerOptions().getOptions()
            .removeAll(java.util.Set.of(Options.DisableListDemotion, Options.DisableListPromotion));
        CrSettings settings = new CrSettings().withEvaluationSettings(evaluationSettings);
        InMemoryFhirRepository data = patientRepository();
        IRepository proxied = Repositories.proxy(data, true, null, content, content);
        DtrPopulateRequest request = new DtrPopulateRequest(questionnaire, "Patient/pat015", new ArrayList<>(),
            new LibraryEngine(proxied, evaluationSettings), Map.of("device_request", deviceRequest()));
        return (QuestionnaireResponse) new QuestionnaireProcessor(data, settings).populate(request);
    }

    private static Optional<QuestionnaireResponseItemComponent> findItem(
            java.util.List<QuestionnaireResponseItemComponent> items, String linkId) {
        for (QuestionnaireResponseItemComponent item : items) {
            if (linkId.equals(item.getLinkId())) {
                return Optional.of(item);
            }
            Optional<QuestionnaireResponseItemComponent> nested = findItem(item.getItem(), linkId);
            if (nested.isPresent()) {
                return nested;
            }
        }
        return Optional.empty();
    }

    private static String answer(QuestionnaireResponse qr, String linkId) {
        return findItem(qr.getItem(), linkId)
            .filter(QuestionnaireResponseItemComponent::hasAnswer)
            .map(item -> item.getAnswerFirstRep().getValue().primitiveValue())
            .orElse(null);
    }

    private static long errorCount(QuestionnaireResponse qr) {
        return qr.getContained().stream()
            .filter(OperationOutcome.class::isInstance)
            .map(OperationOutcome.class::cast)
            .mapToLong(oo -> oo.getIssue().size())
            .sum();
    }

    @Test
    void normalizedPackagePopulatesPatientDemographics() throws Exception {
        QuestionnaireResponse qr = populate(true);

        assertEquals("Oster", answer(qr, "PBD.1"));
        assertEquals("William", answer(qr, "PBD.2"));
        assertEquals("2015-02-23", answer(qr, "PBD.4"));
        assertEquals("male", answer(qr, "PBD.5"));
        assertEquals("E0470", answer(qr, "4.6.1"));
        assertEquals(0, errorCount(qr));
    }

    @Test
    void rawPackageFailsEveryExpression() throws Exception {
        QuestionnaireResponse qr = populate(false);

        assertEquals(null, answer(qr, "PBD.1"));
        assertTrue(errorCount(qr) > 0);
    }
}
