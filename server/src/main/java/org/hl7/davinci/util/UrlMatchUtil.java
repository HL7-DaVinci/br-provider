package org.hl7.davinci.util;

/**
 * URL normalization and boundary-aware prefix matching utilities.
 * Used across proxy controllers and server properties for SSRF protection.
 */
public final class UrlMatchUtil {

    private UrlMatchUtil() {}

    /**
     * Strips trailing slashes from a URL.
     */
    public static String normalizeUrl(String url) {
        return url.replaceAll("/+$", "");
    }

    /**
     * Checks whether a target URL matches a base URL with proper boundary detection,
     * preventing prefix collisions (e.g., base "http://example.com/fhir" must not
     * match target "http://example.com/fhir.evil.com/Patient").
     */
    public static boolean matchesBaseUrl(String target, String baseUrl) {
        if (!target.startsWith(baseUrl)) return false;
        if (target.length() == baseUrl.length()) return true;
        char next = target.charAt(baseUrl.length());
        return next == '/' || next == '?' || next == '#';
    }
}
