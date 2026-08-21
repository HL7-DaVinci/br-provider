package org.hl7.davinci.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.charset.StandardCharsets;

import org.hl7.fhir.r4.model.Attachment;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.CanonicalType;
import org.hl7.fhir.r4.model.Library;
import org.hl7.fhir.r4.model.Questionnaire;
import org.junit.jupiter.api.Test;

class DtrPackageNormalizerTest {

    private static final String CQF_LIBRARY = "http://hl7.org/fhir/StructureDefinition/cqf-library";
    private static final String BASE = "http://hl7.org/fhir/us/davinci-dtr/Library/";

    private static Library library(String id, String name, String url, String version, String cql) {
        Library library = new Library();
        library.setId(id);
        library.setName(name);
        library.setUrl(url);
        library.setVersion(version);
        library.addContent(new Attachment().setContentType("text/cql")
            .setData(cql.getBytes(StandardCharsets.UTF_8)));
        return library;
    }

    private static Questionnaire questionnaireReferencing(String... canonicals) {
        Questionnaire questionnaire = new Questionnaire();
        for (String canonical : canonicals) {
            questionnaire.addExtension(CQF_LIBRARY, new CanonicalType(canonical));
        }
        return questionnaire;
    }

    @Test
    void rewritesLibraryMetadataAndReferencesToMatchCqlHeader() {
        Library mismatched = library("BasicPatientInfo-prepopulation", "BasicPatientInfo-prepopulation",
            BASE + "BasicPatientInfo-prepopulation", "0.0.1",
            "library BasicPatientInfoPrepopulation version '0.2.0'\nusing FHIR version '4.0.1'\n");
        Bundle bundle = new Bundle();
        bundle.addEntry().setResource(mismatched);
        Questionnaire questionnaire = questionnaireReferencing(BASE + "BasicPatientInfo-prepopulation");

        DtrPackageNormalizer.alignLibrariesWithCql(bundle, questionnaire);

        assertEquals("BasicPatientInfoPrepopulation", mismatched.getName());
        assertEquals("0.2.0", mismatched.getVersion());
        assertEquals(BASE + "BasicPatientInfoPrepopulation", mismatched.getUrl());
        assertEquals(BASE + "BasicPatientInfoPrepopulation|0.2.0",
            questionnaire.getExtensionByUrl(CQF_LIBRARY).getValueAsPrimitive().getValueAsString());
    }

    @Test
    void retargetsFhir400CqlToEngineVersionAndDropsStaleElm() {
        Library library = library("Foo", "Foo", BASE + "Foo", "1.0.0",
            "library Foo version '1.0.0'\nusing FHIR version '4.0.0'\ninclude FHIRHelpers version '4.0.0' called FHIRHelpers\n");
        library.addContent(new Attachment().setContentType("application/elm+json").setData("{}".getBytes(StandardCharsets.UTF_8)));
        Bundle bundle = new Bundle();
        bundle.addEntry().setResource(library);

        DtrPackageNormalizer.alignLibrariesWithCql(bundle, new Questionnaire());

        assertEquals(1, library.getContent().size());
        String cql = new String(library.getContent().get(0).getData(), StandardCharsets.UTF_8);
        assertEquals("library Foo version '1.0.0'\nusing FHIR version '4.0.1'\ninclude FHIRHelpers version '4.0.1' called FHIRHelpers\n", cql);
    }

    @Test
    void leavesConsistentLibrariesAndUnrelatedReferencesAlone() {
        Library consistent = library("DTRHelpers", "DTRHelpers", BASE + "DTRHelpers", "0.1.0",
            "library DTRHelpers version '0.1.0'\n");
        Library noUrl = library("FHIRHelpers-4.0.0", "FHIRHelpers-4.0.0", null, "4.0.0",
            "library FHIRHelpers version '4.0.0'\n");
        Bundle bundle = new Bundle();
        bundle.addEntry().setResource(consistent);
        bundle.addEntry().setResource(noUrl);
        Questionnaire questionnaire = questionnaireReferencing(BASE + "DTRHelpers|0.1.0", BASE + "Other");

        DtrPackageNormalizer.alignLibrariesWithCql(bundle, questionnaire);

        assertEquals(BASE + "DTRHelpers", consistent.getUrl());
        assertEquals("FHIRHelpers", noUrl.getName());
        assertEquals(null, noUrl.getUrl());
        assertEquals(BASE + "DTRHelpers|0.1.0",
            questionnaire.getExtensionsByUrl(CQF_LIBRARY).get(0).getValueAsPrimitive().getValueAsString());
        assertEquals(BASE + "Other",
            questionnaire.getExtensionsByUrl(CQF_LIBRARY).get(1).getValueAsPrimitive().getValueAsString());
    }
}
