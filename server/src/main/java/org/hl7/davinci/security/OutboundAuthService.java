package org.hl7.davinci.security;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.util.UrlMatchUtil;
import org.springframework.stereotype.Component;

/**
 * Resolves what authentication an outbound FHIR target expects. Static config supplies hints for
 * declared servers; everything else starts UNKNOWN and is learned from live responses (optimistic
 * tokenless attempt, escalated on 401/403 by callers). Learned modes last for the process
 * lifetime, matching the transient in-memory stack. Config hints always take precedence over
 * learned modes.
 */
@Component
public class OutboundAuthService {

    public enum Mode { OPEN, UDAP_B2B, SMART_BACKEND, UNKNOWN }

    private final ServerProperties serverProperties;
    private final Map<String, Mode> learned = new ConcurrentHashMap<>();

    public OutboundAuthService(ServerProperties serverProperties) {
        this.serverProperties = serverProperties;
    }

    public Mode modeFor(String baseUrl) {
        String normalized = UrlMatchUtil.normalizeUrl(baseUrl);
        Mode hint = configHint(normalized);
        if (hint != null) {
            return hint;
        }
        return learned.getOrDefault(normalized, Mode.UNKNOWN);
    }

    public void recordAuthRequired(String baseUrl) {
        learned.put(UrlMatchUtil.normalizeUrl(baseUrl), Mode.UDAP_B2B);
    }

    public void recordOpen(String baseUrl) {
        learned.put(UrlMatchUtil.normalizeUrl(baseUrl), Mode.OPEN);
    }

    private Mode configHint(String normalized) {
        for (ServerProperties.PayerServer payer : serverProperties.getPayerServers()) {
            if (payer.getFhirUrl() != null && UrlMatchUtil.matchesBaseUrl(
                    normalized, UrlMatchUtil.normalizeUrl(payer.getFhirUrl()))) {
                return "smart-backend".equals(payer.getAuthType())
                    ? Mode.SMART_BACKEND
                    : fromFlag(payer.getRequiresAuth());
            }
        }
        for (ServerProperties.ProviderServer provider : serverProperties.getProviderServers()) {
            if (provider.getUrl() != null && UrlMatchUtil.matchesBaseUrl(
                    normalized, UrlMatchUtil.normalizeUrl(provider.getUrl()))) {
                return "smart-backend".equals(provider.getAuthType())
                    ? Mode.SMART_BACKEND
                    : fromFlag(provider.getRequiresAuth());
            }
        }
        return null;
    }

    /** A configured server without a declared flag falls through to the learned map. */
    private Mode fromFlag(Boolean requiresAuth) {
        if (requiresAuth == null) {
            return null;
        }
        return requiresAuth ? Mode.UDAP_B2B : Mode.OPEN;
    }
}
