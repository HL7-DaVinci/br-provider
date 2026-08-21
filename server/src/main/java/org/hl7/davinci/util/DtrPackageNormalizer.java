package org.hl7.davinci.util;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.hl7.fhir.r4.model.Attachment;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.CanonicalType;
import org.hl7.fhir.r4.model.Extension;
import org.hl7.fhir.r4.model.Library;
import org.hl7.fhir.r4.model.Questionnaire;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Makes the Library resources of a DTR questionnaire package evaluable by the
 * cqf populate engine.
 *
 * Two payer-side inconsistencies break every CQL expression in a package:
 *
 * 1. Library name, version or url tail differ from the CQL header. The compiler
 *    checks the include against the header, and the engine derives both the
 *    include and the expression alias from the cqf-library canonical tail. DTR
 *    requires Library.url to be {@code <namespace>/Library/<CQL library name>},
 *    so the header is treated as the source of truth and the FHIR metadata and
 *    the Questionnaire's cqf-library references are rewritten to match.
 *
 * 2. CQL compiled for FHIR 4.0.0. The engine compiles the item expressions
 *    against FHIR 4.0.1 and cannot load two FHIR model versions at once. The
 *    CQL is retargeted to 4.0.1 and any pre-compiled ELM is dropped so the
 *    engine recompiles from the rewritten source.
 */
public final class DtrPackageNormalizer {

    private static final Logger logger = LoggerFactory.getLogger(DtrPackageNormalizer.class);

    private static final String CQF_LIBRARY = "http://hl7.org/fhir/StructureDefinition/cqf-library";
    private static final String CQL_CONTENT_TYPE = "text/cql";
    private static final String ENGINE_FHIR_VERSION = "4.0.1";
    private static final Pattern CQL_HEADER = Pattern.compile(
        "^\\s*library\\s+(?:\"([^\"]+)\"|([A-Za-z_][A-Za-z0-9_]*))(?:\\s+version\\s+'([^']*)')?",
        Pattern.MULTILINE);
    private static final Pattern FHIR_400 = Pattern.compile(
        "^(\\s*(?:using\\s+FHIR|include\\s+FHIRHelpers)\\s+version\\s+')4\\.0\\.0(')", Pattern.MULTILINE);

    private DtrPackageNormalizer() {
    }

    public static void alignLibrariesWithCql(Bundle packageBundle, Questionnaire questionnaire) {
        Map<String, String> rewrittenCanonicals = new HashMap<>();
        for (Bundle.BundleEntryComponent entry : packageBundle.getEntry()) {
            if (entry.getResource() instanceof Library library) {
                Attachment cql = cqlAttachment(library);
                if (cql != null) {
                    retargetFhirVersion(library, cql);
                    alignMetadata(library, cql, rewrittenCanonicals);
                }
            }
        }
        if (rewrittenCanonicals.isEmpty()) {
            return;
        }
        rewriteCqfLibraryReferences(questionnaire, rewrittenCanonicals);
        for (Bundle.BundleEntryComponent entry : packageBundle.getEntry()) {
            if (entry.getResource() instanceof Questionnaire bundled) {
                rewriteCqfLibraryReferences(bundled, rewrittenCanonicals);
            }
        }
    }

    private static Attachment cqlAttachment(Library library) {
        return library.getContent().stream()
            .filter(c -> CQL_CONTENT_TYPE.equals(c.getContentType()) && c.hasData())
            .findFirst()
            .orElse(null);
    }

    private static void retargetFhirVersion(Library library, Attachment cql) {
        String source = new String(cql.getData(), StandardCharsets.UTF_8);
        String retargeted = FHIR_400.matcher(source).replaceAll("$1" + ENGINE_FHIR_VERSION + "$2");
        if (retargeted.equals(source)) {
            return;
        }
        logger.debug("Retargeting Library {} CQL from FHIR 4.0.0 to {}", library.getId(), ENGINE_FHIR_VERSION);
        cql.setData(retargeted.getBytes(StandardCharsets.UTF_8));
        library.getContent().removeIf(c -> c != cql && c.getContentType() != null
            && c.getContentType().startsWith("application/elm"));
    }

    private static void alignMetadata(Library library, Attachment cql, Map<String, String> rewrittenCanonicals) {
        Matcher header = CQL_HEADER.matcher(new String(cql.getData(), StandardCharsets.UTF_8));
        if (!header.find()) {
            return;
        }
        String cqlName = header.group(1) != null ? header.group(1) : header.group(2);
        String cqlVersion = header.group(3);
        String oldUrl = library.getUrl();
        String newUrl = oldUrl == null ? null : oldUrl.substring(0, oldUrl.lastIndexOf('/') + 1) + cqlName;

        boolean nameMatches = cqlName.equals(library.getName());
        boolean versionMatches = cqlVersion == null || cqlVersion.equals(library.getVersion());
        if (nameMatches && versionMatches && Objects.equals(oldUrl, newUrl)) {
            return;
        }

        logger.debug("Aligning Library {} ({} {}) with its CQL header {} {}",
            library.getId(), library.getName(), library.getVersion(), cqlName, cqlVersion);
        library.setName(cqlName);
        if (cqlVersion != null) {
            library.setVersion(cqlVersion);
        }
        if (oldUrl != null) {
            library.setUrl(newUrl);
            String versioned = library.hasVersion() ? newUrl + "|" + library.getVersion() : newUrl;
            rewrittenCanonicals.put(oldUrl, versioned);
        }
    }

    private static void rewriteCqfLibraryReferences(Questionnaire questionnaire, Map<String, String> rewritten) {
        for (Extension extension : questionnaire.getExtensionsByUrl(CQF_LIBRARY)) {
            if (extension.getValue() instanceof CanonicalType canonical && canonical.hasValue()) {
                String unversioned = canonical.getValue().split("\\|", 2)[0];
                String replacement = rewritten.get(unversioned);
                if (replacement != null) {
                    canonical.setValue(replacement);
                }
            }
        }
    }
}
