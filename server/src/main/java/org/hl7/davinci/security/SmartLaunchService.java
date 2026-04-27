package org.hl7.davinci.security;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * Manages SMART EHR launch contexts for the DTR app launch flow.
 * Stores launch context keyed by a random token with 5-minute auto-expiry.
 * The frontend calls POST /api/smart/launch to create a context, then opens
 * the DTR route with the returned launch token.
 */
@Service
public class SmartLaunchService {

    private static final long LAUNCH_TTL_SECONDS = 300;
    public static final String SELECTED_PATIENT_CONTEXT_PARAMETER = "smart_patient_context";

    private final ConcurrentHashMap<String, LaunchContext> launchContexts = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, SelectedPatientContext> selectedPatientContexts = new ConcurrentHashMap<>();

    /**
     * Creates a new launch context and returns the opaque launch token.
     *
     * @param patientId             Patient resource ID
     * @param encounterId           Encounter resource ID (may be null)
     * @param fhirContextReferences FHIR resource references for DTR context
     *                              (e.g. Coverage/123, ServiceRequest/456)
     * @param appContext            Raw CDS Hooks appContext string (preserved opaquely)
     * @return opaque launch token (UUID)
     */
    public String createLaunchContext(String patientId, String encounterId,
                                      List<String> fhirContextReferences,
                                      String coverageAssertionId,
                                      List<String> questionnaire,
                                      String appContext) {
        String launchToken = UUID.randomUUID().toString();
        launchContexts.put(launchToken, new LaunchContext(
            patientId, encounterId, fhirContextReferences,
            coverageAssertionId, questionnaire, appContext, Instant.now()));
        return launchToken;
    }

    public LaunchContext peekLaunchContext(String launchToken) {
        LaunchContext ctx = launchContexts.get(launchToken);
        if (isExpired(ctx)) {
            launchContexts.remove(launchToken);
            return null;
        }
        return ctx;
    }

    /**
     * Consumes (removes) a launch context by token. Returns null if the token
     * does not exist or has expired (older than 5 minutes).
     */
    public LaunchContext consumeLaunchContext(String launchToken) {
        LaunchContext ctx = launchContexts.remove(launchToken);
        if (isExpired(ctx)) {
            return null;
        }
        return ctx;
    }

    public ResolvedLaunchContext resolveForToken(
            String launchToken,
            Set<String> scopes,
            FhirUserDetails user,
            String selectedPatientContextToken) {
        if (scopes.contains("launch")) {
            LaunchContext ctx = consumeLaunchContext(launchToken);
            if (ctx == null) {
                return null;
            }
            return new ResolvedLaunchContext(
                ctx.patientId(),
                ctx.encounterId(),
                safeList(ctx.fhirContextReferences()),
                true
            );
        }

        if (requiresPatientContext(scopes)) {
            String patientId = null;
            if (user != null && "Patient".equals(user.getFhirResourceType())) {
                patientId = idPart(user.getFhirResourceReference());
            } else if (user != null) {
                patientId = consumeSelectedPatientContext(selectedPatientContextToken, user.getUsername());
            }
            if (patientId == null || patientId.isBlank()) {
                return null;
            }
            return new ResolvedLaunchContext(patientId, null, List.of(), true);
        }

        return null;
    }

    public String createSelectedPatientContext(String patientId, String username) {
        String contextToken = UUID.randomUUID().toString();
        selectedPatientContexts.put(contextToken, new SelectedPatientContext(patientId, username, Instant.now()));
        return contextToken;
    }

    public String consumeSelectedPatientContext(String contextToken, String username) {
        if (contextToken == null || contextToken.isBlank()) {
            return null;
        }
        SelectedPatientContext context = selectedPatientContexts.get(contextToken);
        if (context == null) {
            return null;
        }
        if (isExpired(context.createdAt())) {
            selectedPatientContexts.remove(contextToken);
            return null;
        }
        if (context.username() != null && !context.username().equals(username)) {
            return null;
        }
        if (!selectedPatientContexts.remove(contextToken, context)) {
            return null;
        }
        return context.patientId();
    }

    private static boolean requiresPatientContext(Set<String> scopes) {
        return scopes.contains("launch/patient")
            || scopes.stream().anyMatch(scope -> scope.startsWith("patient/"));
    }

    private static String idPart(String reference) {
        if (reference == null) {
            return null;
        }
        int slash = reference.indexOf('/');
        return slash >= 0 ? reference.substring(slash + 1) : reference;
    }

    private static List<String> safeList(List<String> values) {
        if (values == null) {
            return List.of();
        }
        List<String> filtered = new ArrayList<>();
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                filtered.add(value);
            }
        }
        return Collections.unmodifiableList(filtered);
    }

    private static boolean isExpired(LaunchContext ctx) {
        return ctx != null && isExpired(ctx.createdAt());
    }

    private static boolean isExpired(Instant createdAt) {
        return createdAt.plusSeconds(LAUNCH_TTL_SECONDS).isBefore(Instant.now());
    }

    public record LaunchContext(
        String patientId,
        String encounterId,
        List<String> fhirContextReferences,
        String coverageAssertionId,
        List<String> questionnaire,
        String appContext,
        Instant createdAt
    ) {}

    public record SelectedPatientContext(
        String patientId,
        String username,
        Instant createdAt
    ) {}

    public record ResolvedLaunchContext(
        String patientId,
        String encounterId,
        List<String> fhirContextReferences,
        boolean needPatientBanner
    ) {}
}
