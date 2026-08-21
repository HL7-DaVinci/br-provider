package org.hl7.davinci.api;

import java.util.List;
import java.util.Map;

import org.hl7.fhir.instance.model.api.IBaseBackboneElement;
import org.hl7.fhir.instance.model.api.IBaseParameters;
import org.hl7.fhir.r4.model.Parameters;
import org.hl7.fhir.r4.model.Questionnaire;
import org.hl7.fhir.r4.model.Resource;
import org.opencds.cqf.fhir.cql.LibraryEngine;
import org.opencds.cqf.fhir.cr.questionnaire.populate.PopulateRequest;
import org.opencds.cqf.fhir.utility.model.FhirModelResolverCache;

import ca.uhn.fhir.context.FhirVersionEnum;
import ca.uhn.fhir.model.primitive.IdDt;

/**
 * Populate request that exposes the order under the CQL parameter names the
 * Da Vinci DTR reference libraries declare ({@code device_request},
 * {@code service_request}, {@code medication_request}). SDC launchContext has
 * no slot for the order, so the engine would otherwise leave those parameters
 * unbound and every order-driven expression evaluates to null.
 */
public class DtrPopulateRequest extends PopulateRequest {

    public static final List<String> ORDER_PARAMETER_NAMES =
        List.of("device_request", "service_request", "medication_request");

    private final Map<String, Resource> cqlParameters;

    public DtrPopulateRequest(
            Questionnaire questionnaire,
            String subject,
            List<? extends IBaseBackboneElement> context,
            LibraryEngine libraryEngine,
            Map<String, Resource> cqlParameters) {
        super(questionnaire, new IdDt(subject), context, null, null, libraryEngine,
            FhirModelResolverCache.resolverForVersion(FhirVersionEnum.R4));
        this.cqlParameters = cqlParameters;
    }

    @Override
    public IBaseParameters getParameters() {
        Parameters parameters = (Parameters) super.getParameters();
        cqlParameters.forEach((name, resource) -> parameters.addParameter().setName(name).setResource(resource));
        return parameters;
    }
}
