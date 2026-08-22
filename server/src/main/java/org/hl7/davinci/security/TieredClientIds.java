package org.hl7.davinci.security;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Optional;

/**
 * Reversible client_id encoding for UDAP Tiered OAuth clients: the client_id
 * is the issuer URL itself, base64url-encoded without padding. This lets a
 * RegisteredClient be reconstructed from the client_id alone after a restart
 * clears the in-memory client store, instead of requiring persistence or a
 * configured client list.
 */
final class TieredClientIds {

    private TieredClientIds() {}

    static String encode(String issuer) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(issuer.getBytes(StandardCharsets.UTF_8));
    }

    static Optional<String> decode(String clientId) {
        String decoded;
        try {
            decoded = new String(Base64.getUrlDecoder().decode(clientId), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }

        URI uri;
        try {
            uri = new URI(decoded);
        } catch (URISyntaxException e) {
            return Optional.empty();
        }

        boolean isHttpUrl = uri.isAbsolute()
            && ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()));
        if (!isHttpUrl || uri.getRawQuery() != null || uri.getRawFragment() != null) {
            return Optional.empty();
        }
        return Optional.of(decoded);
    }
}
