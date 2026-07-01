package org.hl7.davinci.api;

import java.util.List;
import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.SpaAuthController;
import org.hl7.davinci.util.UrlMatchUtil;

/**
 * Shared utilities for proxy controllers.
 */
public final class ProxyUtil {

    public static final List<String> DTR_SCOPES = List.of("system/*.rs");

    public static final List<String> PAS_SCOPES = List.of(
        "system/Claim.crus", "system/ClaimResponse.rs");

    public static final List<String> FHIR_READ_SCOPES = List.of("system/*.read");

    public static final List<String> SUBMIT_ATTACHMENT_SCOPES = List.of("system/*.write");

    public static final List<String> SUBSCRIPTION_SCOPES = List.of("system/Subscription.cruds");

    /**
     * Maps a payer operation key (the {@code op} query parameter on the FHIR proxy) to the
     * least-privilege B2B scope set requested for that operation. The browser may only name a
     * key from this allowlist; it cannot request raw {@code system/*} scopes.
     */
    public static final Map<String, List<String>> PAYER_OP_SCOPES = Map.of(
        "read", FHIR_READ_SCOPES,
        "pas-submit", PAS_SCOPES,
        "dtr", DTR_SCOPES,
        "submit-attachment", SUBMIT_ATTACHMENT_SCOPES,
        "subscription", SUBSCRIPTION_SCOPES);

    /**
     * Resolves the B2B scopes for a payer proxy operation key, defaulting to read-only when none
     * is supplied.
     * @throws IllegalArgumentException if the key is not in {@link #PAYER_OP_SCOPES}
     */
    public static List<String> payerScopesForOp(String op) {
        String key = (op == null || op.isBlank()) ? "read" : op;
        List<String> scopes = PAYER_OP_SCOPES.get(key);
        if (scopes == null) {
            throw new IllegalArgumentException("Unknown payer operation: " + op);
        }
        return scopes;
    }

    private ProxyUtil() {}

    /**
     * Resolves the active provider FHIR base URL for the current request.
     * Reads the session's recorded server (set by the OAuth callback or by
     * {@code POST /auth/active-server}); falls back to the built-in
     * provider server when the session has no record.
     */
    public static String getActiveProviderFhirBase(
            HttpServletRequest request,
            ServerProperties serverProperties) {
        return getActiveProviderFhirBase(
            request != null ? request.getSession(false) : null,
            serverProperties
        );
    }

    /**
     * Resolves the active provider FHIR base URL for the current session.
     */
    public static String getActiveProviderFhirBase(
            HttpSession session,
            ServerProperties serverProperties) {
        if (session != null) {
            String sessionServer = (String) session.getAttribute(
                SpaAuthController.SESSION_SERVER_URL);
            if (sessionServer != null && !sessionServer.isBlank()) {
                return UrlMatchUtil.normalizeUrl(sessionServer);
            }
        }
        return serverProperties.getLocalServerAddress();
    }
}
