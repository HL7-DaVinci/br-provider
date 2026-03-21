package org.hl7.davinci.security;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Validates outbound discovery and UDAP targets before the server makes
 * HTTP requests to user-supplied or metadata-supplied endpoints.
 */
@Component
public class OutboundTargetValidator {

    private final Set<String> allowedLocalHosts;

    public OutboundTargetValidator(SecurityProperties securityProperties) {
        this.allowedLocalHosts = securityProperties.getAllowedLocalHosts().stream()
            .map(OutboundTargetValidator::normalizeHost)
            .collect(Collectors.toUnmodifiableSet());
    }

    public URI validate(String rawUrl) {
        final URI uri;
        try {
            uri = URI.create(rawUrl);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid target URL");
        }

        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new IllegalArgumentException("Target URL must use http or https");
        }
        if (!uri.isAbsolute() || uri.getHost() == null || uri.getHost().isBlank()) {
            throw new IllegalArgumentException("Target URL must include a host");
        }
        if (uri.getUserInfo() != null) {
            throw new IllegalArgumentException("Target URL must not include user info");
        }
        if (uri.getRawQuery() != null) {
            throw new IllegalArgumentException("Target URL must not include a query string");
        }
        if (uri.getRawFragment() != null) {
            throw new IllegalArgumentException("Target URL must not include a fragment");
        }

        String normalizedHost = normalizeHost(uri.getHost());
        if (allowedLocalHosts.contains(normalizedHost)) {
            return uri;
        }

        try {
            InetAddress[] addresses = InetAddress.getAllByName(uri.getHost());
            if (addresses.length == 0) {
                throw new IllegalArgumentException("Target host did not resolve");
            }
            for (InetAddress address : addresses) {
                if (isBlockedAddress(address)) {
                    throw new IllegalArgumentException("Target host resolves to a local or non-public address");
                }
            }
            return uri;
        } catch (UnknownHostException e) {
            throw new IllegalArgumentException("Target host did not resolve");
        }
    }

    private static String normalizeHost(String host) {
        return host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
    }

    private static boolean isBlockedAddress(InetAddress address) {
        return address.isAnyLocalAddress()
            || address.isLoopbackAddress()
            || address.isLinkLocalAddress()
            || address.isSiteLocalAddress()
            || address.isMulticastAddress()
            || isCarrierGradeNat(address)
            || isBenchmarkRange(address)
            || isDocumentationRange(address)
            || isUniqueLocalIpv6(address);
    }

    private static boolean isCarrierGradeNat(InetAddress address) {
        if (!(address instanceof Inet4Address)) return false;
        byte[] bytes = address.getAddress();
        int first = bytes[0] & 0xff;
        int second = bytes[1] & 0xff;
        return first == 100 && second >= 64 && second <= 127;
    }

    private static boolean isBenchmarkRange(InetAddress address) {
        if (!(address instanceof Inet4Address)) return false;
        byte[] bytes = address.getAddress();
        int first = bytes[0] & 0xff;
        int second = bytes[1] & 0xff;
        return first == 198 && (second == 18 || second == 19);
    }

    private static boolean isDocumentationRange(InetAddress address) {
        if (!(address instanceof Inet4Address)) return false;
        byte[] bytes = address.getAddress();
        int first = bytes[0] & 0xff;
        int second = bytes[1] & 0xff;
        int third = bytes[2] & 0xff;
        return (first == 192 && second == 0 && third == 2)
            || (first == 198 && second == 51 && third == 100)
            || (first == 203 && second == 0 && third == 113);
    }

    private static boolean isUniqueLocalIpv6(InetAddress address) {
        if (!(address instanceof Inet6Address)) return false;
        byte[] bytes = address.getAddress();
        int first = bytes[0] & 0xff;
        return (first & 0xfe) == 0xfc;
    }
}
