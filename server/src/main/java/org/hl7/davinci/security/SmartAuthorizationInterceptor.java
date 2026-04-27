package org.hl7.davinci.security;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import ca.uhn.fhir.interceptor.auth.CompartmentSearchParameterModifications;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.RestfulServer;
import ca.uhn.fhir.rest.server.interceptor.auth.AuthorizationInterceptor;
import ca.uhn.fhir.rest.server.interceptor.auth.IAuthRule;
import ca.uhn.fhir.rest.server.interceptor.auth.IAuthRuleBuilder;
import ca.uhn.fhir.rest.server.interceptor.auth.PolicyEnum;
import ca.uhn.fhir.rest.server.interceptor.auth.RuleBuilder;
import ca.uhn.fhir.rest.server.servlet.ServletRequestDetails;
import com.nimbusds.jwt.JWTClaimsSet;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import org.hl7.fhir.instance.model.api.IIdType;
import org.hl7.fhir.r4.model.IdType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Translates the SMART scopes carried by the validated bearer token into
 * HAPI's IAuthRule list, then lets HAPI's AuthorizationInterceptor enforce
 * compartment membership, search parameter filtering, and write/delete
 * rules natively.
 */
@Component
public class SmartAuthorizationInterceptor extends AuthorizationInterceptor {

    static final String CLAIMS_REQUEST_ATTR = "smart.claims";

    private static final Logger logger = LoggerFactory.getLogger(SmartAuthorizationInterceptor.class);

    private final SecurityProperties securityProperties;

    @Autowired
    private RestfulServer restfulServer;

    public SmartAuthorizationInterceptor(SecurityProperties securityProperties) {
        super(PolicyEnum.DENY);
        this.securityProperties = securityProperties;
    }

    @PostConstruct
    public void register() {
        restfulServer.registerInterceptor(this);
    }

    @Override
    public List<IAuthRule> buildRuleList(RequestDetails requestDetails) {

        if (!securityProperties.isEnableAuthentication()) {
            return new RuleBuilder().allowAll().build();
        }

        if (requestDetails.getHeader(securityProperties.getBypassHeader()) != null) {
            return new RuleBuilder().allowAll().build();
        }

        IAuthRuleBuilder builder = new RuleBuilder();
        // CapabilityStatement, .well-known/* etc. -- HAPI's metadata rule covers them.
        builder.allow().metadata().andThen();

        JWTClaimsSet claims = readClaims(requestDetails);
        if (claims == null) {
            // No SMART context (e.g., request bypassed the bearer-token branch
            // by being a public endpoint that AuthInterceptor whitelisted).
            // Public endpoints already returned before we get here, so denying
            // everything else is safe.
            return builder.build();
        }

        Set<String> scopes = parseScopes(claims.getClaim("scope"));
        String patientContextId = resolvePatientContext(claims);
        boolean grantedAnyResourceScope = false;
        boolean grantedAnyPatientScope = false;
        boolean grantedAnyUserOrSystemScope = false;

        CompartmentSearchParameterModifications compartmentMods = buildCompartmentExtensions();

        for (String scope : scopes) {
            ParsedScope parsed = ParsedScope.parse(scope);
            if (parsed == null) continue;

            switch (parsed.compartment) {
                case "user":
                case "system":
                    grantedAnyResourceScope = true;
                    grantedAnyUserOrSystemScope = true;
                    applyResourceWideRule(builder, parsed);
                    break;
                case "patient":
                    if (patientContextId == null) {
                        logger.debug("Patient-scope {} ignored: no patient context on token", scope);
                        continue;
                    }
                    grantedAnyResourceScope = true;
                    grantedAnyPatientScope = true;
                    applyPatientCompartmentRule(builder, parsed, patientContextId, compartmentMods);
                    break;
                default:
                    // Identity-only scopes (openid, fhirUser, profile, udap) carry no resource access.
            }
        }

        if (grantedAnyPatientScope) {
            // Cross-patient "reference data" resources -- the explicit allowlist
            // of non-compartment types a patient is allowed to read in order to
            // resolve names/details on resources within their own compartment
            // (e.g., the Organization on a Coverage.payor). Anything not in
            // this list, not in the Patient compartment, and not extended into
            // it via patient-compartment-extensions is denied by default.
            for (String resourceType : securityProperties.getReferenceDataResources()) {
                builder.allow().read().resourcesOfType(resourceType).withAnyId().andThen();
            }
        }

        if (grantedAnyResourceScope) {
            // Transactions and batches POST to the FHIR base. HAPI checks each entry against
            // the rules above; without an explicit transaction rule, even individually-allowed
            // entries are denied. andApplyNormalRules() runs the entry-level checks.
            builder.allow().transaction().withAnyOperation().andApplyNormalRules().andThen();
        }

        if (grantedAnyUserOrSystemScope) {
            // Operations ($populate, $expand, $everything, ...) need their own rule.
            // user/* and system/* scopes are broad enough to authorize them.
            builder.allow().operation().withAnyName().onAnyType().andAllowAllResponses().andThen();
            builder.allow().operation().withAnyName().atAnyLevel().andAllowAllResponses().andThen();
        } else if (grantedAnyPatientScope) {
            // Patient-scoped tokens may invoke operations on their own Patient instance
            // (e.g., Patient/$everything for self-export).
            builder.allow().operation().withAnyName()
                .onInstance(new IdType("Patient", patientContextId))
                .andAllowAllResponses().andThen();
        }

        return builder.build();
    }

    private JWTClaimsSet readClaims(RequestDetails requestDetails) {
        if (!(requestDetails instanceof ServletRequestDetails servletDetails)) {
            return null;
        }
        HttpServletRequest request = servletDetails.getServletRequest();
        if (request == null) return null;
        Object value = request.getAttribute(CLAIMS_REQUEST_ATTR);
        return value instanceof JWTClaimsSet ? (JWTClaimsSet) value : null;
    }

    private static void applyResourceWideRule(IAuthRuleBuilder builder, ParsedScope parsed) {
        if (parsed.canRead) {
            if ("*".equals(parsed.resourceType)) {
                builder.allow().read().allResources().withAnyId().andThen();
            } else {
                builder.allow().read().resourcesOfType(parsed.resourceType).withAnyId().andThen();
            }
        }
        if (parsed.canWrite) {
            if ("*".equals(parsed.resourceType)) {
                builder.allow().write().allResources().withAnyId().andThen();
                builder.allow().create().allResources().withAnyId().andThen();
            } else {
                builder.allow().write().resourcesOfType(parsed.resourceType).withAnyId().andThen();
                builder.allow().create().resourcesOfType(parsed.resourceType).withAnyId().andThen();
            }
        }
        if (parsed.canDelete) {
            if ("*".equals(parsed.resourceType)) {
                builder.allow().delete().allResources().withAnyId().andThen();
            } else {
                builder.allow().delete().resourcesOfType(parsed.resourceType).withAnyId().andThen();
            }
        }
    }

    private static void applyPatientCompartmentRule(
            IAuthRuleBuilder builder,
            ParsedScope parsed,
            String patientId,
            CompartmentSearchParameterModifications mods) {
        IIdType patientRef = new IdType("Patient", patientId);
        if (parsed.canRead) {
            if ("*".equals(parsed.resourceType)) {
                builder.allow().read().allResources().inModifiedCompartment("Patient", patientRef, mods).andThen();
            } else if ("Patient".equals(parsed.resourceType)) {
                // Read of the patient's own Patient resource. inCompartment also covers this
                // but instance() is clearer about the limit.
                builder.allow().read().instance(patientRef).andThen();
            } else {
                builder.allow().read().resourcesOfType(parsed.resourceType).inModifiedCompartment("Patient", patientRef, mods).andThen();
            }
        }
        if (parsed.canWrite) {
            if ("*".equals(parsed.resourceType)) {
                builder.allow().write().allResources().inModifiedCompartment("Patient", patientRef, mods).andThen();
                builder.allow().create().allResources().inModifiedCompartment("Patient", patientRef, mods).andThen();
            } else if ("Patient".equals(parsed.resourceType)) {
                builder.allow().write().instance(patientRef).andThen();
            } else {
                builder.allow().write().resourcesOfType(parsed.resourceType).inModifiedCompartment("Patient", patientRef, mods).andThen();
                builder.allow().create().resourcesOfType(parsed.resourceType).inModifiedCompartment("Patient", patientRef, mods).andThen();
            }
        }
        if (parsed.canDelete) {
            if ("*".equals(parsed.resourceType)) {
                builder.allow().delete().allResources().inModifiedCompartment("Patient", patientRef, mods).andThen();
            } else if ("Patient".equals(parsed.resourceType)) {
                builder.allow().delete().instance(patientRef).andThen();
            } else {
                builder.allow().delete().resourcesOfType(parsed.resourceType).inModifiedCompartment("Patient", patientRef, mods).andThen();
            }
        }
    }

    /**
     * Builds compartment extensions from configuration.
     */
    private CompartmentSearchParameterModifications buildCompartmentExtensions() {
        CompartmentSearchParameterModifications mods = new CompartmentSearchParameterModifications();
        Map<String, List<String>> extensions = securityProperties.getPatientCompartmentExtensions();
        if (extensions == null) return mods;
        for (Map.Entry<String, List<String>> entry : extensions.entrySet()) {
            String resourceType = entry.getKey();
            List<String> paramCodes = entry.getValue();
            if (paramCodes == null) continue;
            for (String paramCode : paramCodes) {
                if (paramCode != null && !paramCode.isBlank()) {
                    mods.addSPToIncludeInCompartment(resourceType, paramCode);
                }
            }
        }
        return mods;
    }

    static Set<String> parseScopes(Object scopeClaim) {
        Set<String> scopes = new LinkedHashSet<>();
        if (scopeClaim instanceof String s) {
            for (String token : s.split("\\s+")) {
                if (!token.isBlank()) scopes.add(token);
            }
        } else if (scopeClaim instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof String s && !s.isBlank()) scopes.add(s);
            }
        }
        return scopes;
    }

    static String resolvePatientContext(JWTClaimsSet claims) {
        String patient = stringClaim(claims, "patient");
        if (patient != null && !patient.isBlank()) {
            return patient;
        }
        String fhirUser = stringClaim(claims, "fhirUser");
        if (fhirUser == null) return null;
        int sep = fhirUser.lastIndexOf('/');
        if (sep < 0) return null;
        String type = fhirUser.substring(0, sep);
        String id = fhirUser.substring(sep + 1);
        // Match exact "Patient" or a path ending in "/Patient" so values like
        // "NotAPatient/123" or "AlsoAPatient/123" don't slip through a substring match.
        if (!(type.equals("Patient") || type.endsWith("/Patient")) || id.isBlank()) return null;
        return id;
    }

    private static String stringClaim(JWTClaimsSet claims, String name) {
        try {
            return claims.getStringClaim(name);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * SMART scope parsed into compartment, resourceType, and permission flags.
     * Returns null for scopes that don't match the {compartment}/{resource}.{permission} grammar.
     */
    record ParsedScope(String compartment, String resourceType, boolean canRead,
                       boolean canWrite, boolean canDelete) {

        static ParsedScope parse(String raw) {
            int slash = raw.indexOf('/');
            int dot = raw.indexOf('.');
            if (slash <= 0 || dot <= slash + 1 || dot >= raw.length() - 1) {
                return null;
            }
            String compartment = raw.substring(0, slash);
            String resource = raw.substring(slash + 1, dot);
            String permission = raw.substring(dot + 1);
            if (!"user".equals(compartment) && !"patient".equals(compartment) && !"system".equals(compartment)) {
                return null;
            }
            return new ParsedScope(
                compartment,
                resource,
                permissionGrants(permission, "r", "s"),
                permissionGrants(permission, "c", "u"),
                permissionGrants(permission, "d")
            );
        }

        private static boolean permissionGrants(String permission, String... required) {
            if ("*".equals(permission)) return true;
            if ("read".equals(permission)) return Arrays.asList(required).contains("r") || Arrays.asList(required).contains("s");
            if ("write".equals(permission)) return Arrays.asList(required).contains("c") || Arrays.asList(required).contains("u") || Arrays.asList(required).contains("d");
            if (!isCompactPermission(permission)) return false;
            for (String r : required) {
                if (permission.contains(r)) return true;
            }
            return false;
        }

        private static boolean isCompactPermission(String permission) {
            if (permission == null || permission.isBlank()) return false;
            for (int i = 0; i < permission.length(); i++) {
                if ("cruds".indexOf(permission.charAt(i)) < 0) return false;
            }
            return true;
        }
    }
}
