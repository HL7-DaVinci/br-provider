package org.hl7.davinci.security;

import java.time.Instant;
import java.util.List;
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

    private final ConcurrentHashMap<String, LaunchContext> launchContexts = new ConcurrentHashMap<>();

    /**
     * Creates a new launch context and returns the opaque launch token.
     *
     * @param patientId             Patient resource ID
     * @param encounterId           Encounter resource ID (may be null)
     * @param fhirContextReferences FHIR resource references for DTR context
     *                              (e.g. Coverage/123, ServiceRequest/456)
     * @return opaque launch token (UUID)
     */
    public String createLaunchContext(String patientId, String encounterId,
                                      List<String> fhirContextReferences,
                                      String coverageAssertionId,
                                      List<String> questionnaire) {
        String launchToken = UUID.randomUUID().toString();
        launchContexts.put(launchToken, new LaunchContext(
            patientId, encounterId, fhirContextReferences,
            coverageAssertionId, questionnaire, Instant.now()));
        return launchToken;
    }

    /**
     * Consumes (removes) a launch context by token. Returns null if the token
     * does not exist or has expired (older than 5 minutes).
     */
    public LaunchContext consumeLaunchContext(String launchToken) {
        LaunchContext ctx = launchContexts.remove(launchToken);
        if (ctx != null && ctx.createdAt().plusSeconds(300).isBefore(Instant.now())) {
            return null;
        }
        return ctx;
    }

    public record LaunchContext(
        String patientId,
        String encounterId,
        List<String> fhirContextReferences,
        String coverageAssertionId,
        List<String> questionnaire,
        Instant createdAt
    ) {}
}
