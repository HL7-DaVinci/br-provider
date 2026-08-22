package org.hl7.davinci.security;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.OctetSequenceKey;
import org.junit.jupiter.api.Test;

class UdapClientKeyStoreTest {

    private static JWK key(int i) {
        return new OctetSequenceKey.Builder(new byte[] {(byte) i, 1, 2, 3}).build();
    }

    @Test
    void evictsLeastRecentlyUsedKeyBeyondCap() {
        UdapClientKeyStore store = new UdapClientKeyStore();
        for (int i = 0; i <= UdapClientKeyStore.MAX_KEYS; i++) {
            store.put("client-" + i, key(i));
        }
        assertNull(store.get("client-0"));
        assertNotNull(store.get("client-1"));
        assertNotNull(store.get("client-" + UdapClientKeyStore.MAX_KEYS));
    }

    @Test
    void recentGetKeepsKeyAlive() {
        UdapClientKeyStore store = new UdapClientKeyStore();
        for (int i = 0; i < UdapClientKeyStore.MAX_KEYS; i++) {
            store.put("client-" + i, key(i));
        }
        store.get("client-0");
        store.put("overflow", key(0));
        assertNotNull(store.get("client-0"));
        assertNull(store.get("client-1"));
    }
}
