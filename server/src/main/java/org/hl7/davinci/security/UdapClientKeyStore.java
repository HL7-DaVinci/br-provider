package org.hl7.davinci.security;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import com.nimbusds.jose.jwk.JWK;
import org.springframework.stereotype.Component;

/**
 * Public keys for UDAP-registered clients, keyed by client_id. Populated by
 * DCR and by {@link UdapClientAssertionKeyFilter}, read by the /oauth2/udap-jwks
 * endpoint that Spring Authorization Server fetches to validate
 * private_key_jwt client assertions.
 *
 * Bounded least-recently-used map: any self-consistent client_assertion can
 * add a key before the client repository enforces its own cap, so the store
 * caps itself too. An evicted key is re-learned from the client's next assertion.
 */
@Component
class UdapClientKeyStore {

    static final int MAX_KEYS = MutableRegisteredClientRepository.MAX_RECOVERED_CLIENTS;

    private final Map<String, JWK> keysByClientId = Collections.synchronizedMap(
        new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, JWK> eldest) {
                return size() > MAX_KEYS;
            }
        });

    void put(String clientId, JWK jwk) {
        keysByClientId.put(clientId, jwk);
    }

    JWK get(String clientId) {
        return keysByClientId.get(clientId);
    }
}
