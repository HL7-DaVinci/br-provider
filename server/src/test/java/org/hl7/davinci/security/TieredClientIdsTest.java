package org.hl7.davinci.security;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TieredClientIdsTest {

    @Test
    void roundTrip() {
        String issuer = "https://ri.example.org/fhir/auth";
        String clientId = TieredClientIds.encode(issuer);
        assertEquals(Optional.of(issuer), TieredClientIds.decode(clientId));
    }

    @Test
    void decode_rejectsNonBase64() {
        assertEquals(Optional.empty(), TieredClientIds.decode("not base64!!"));
    }

    @Test
    void decode_rejectsBase64ThatIsNotAUrl() {
        String clientId = TieredClientIds.encode("not a url");
        assertEquals(Optional.empty(), TieredClientIds.decode(clientId));
    }

    @Test
    void decode_rejectsUrlWithQuery() {
        String clientId = TieredClientIds.encode("https://example.com?a=b");
        assertEquals(Optional.empty(), TieredClientIds.decode(clientId));
    }

    @Test
    void decode_rejectsUrlWithFragment() {
        String clientId = TieredClientIds.encode("https://example.com#section");
        assertEquals(Optional.empty(), TieredClientIds.decode(clientId));
    }

    @Test
    void decode_rejectsNonHttpScheme() {
        String clientId = TieredClientIds.encode("javascript:alert(1)");
        assertEquals(Optional.empty(), TieredClientIds.decode(clientId));
    }
}
