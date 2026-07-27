package org.hl7.davinci.util;

import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import jakarta.servlet.http.HttpServletRequest;

/**
 * Extracts custom headers the SPA asks the BFF proxy to forward upstream.
 * The SPA sends each custom header as {@code X-Fwd-<Name>}. The proxy strips
 * the prefix and forwards {@code <Name>: value} to the target server. A
 * forwarded Authorization header signals that the proxy must not inject its
 * own token for the request.
 */
public final class ForwardedHeaderUtil {

    public static final String PREFIX = "x-fwd-";

    private static final Set<String> DISALLOWED = Set.of(
        "host", "connection", "content-length", "transfer-encoding",
        "keep-alive", "upgrade", "te", "trailer", "expect",
        "proxy-authorization", "proxy-authenticate");

    public record ForwardedHeaders(Map<String, String> headers, boolean hasAuthorization) {
        /** True if a forwarded header shadows {@code name}, case-insensitively. */
        public boolean contains(String name) {
            for (String key : headers.keySet()) {
                if (key.equalsIgnoreCase(name)) {
                    return true;
                }
            }
            return false;
        }
    }

    private ForwardedHeaderUtil() {}

    public static ForwardedHeaders extract(HttpServletRequest request) {
        Map<String, String> headers = new LinkedHashMap<>();
        boolean hasAuthorization = false;
        Enumeration<String> names = request.getHeaderNames();
        while (names != null && names.hasMoreElements()) {
            String rawName = names.nextElement();
            String lower = rawName.toLowerCase(Locale.ROOT);
            if (!lower.startsWith(PREFIX)) {
                continue;
            }
            String strippedName = rawName.substring(PREFIX.length());
            String strippedLower = lower.substring(PREFIX.length());
            if (strippedLower.isEmpty() || DISALLOWED.contains(strippedLower)) {
                continue;
            }
            headers.put(strippedName, request.getHeader(rawName));
            if ("authorization".equals(strippedLower)) {
                hasAuthorization = true;
            }
        }
        return new ForwardedHeaders(headers, hasAuthorization);
    }
}
