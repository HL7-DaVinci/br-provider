package org.hl7.davinci.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.nimbusds.jose.jwk.JWKSet;
import org.hl7.davinci.security.SmartClientKeyService;
import org.junit.jupiter.api.Test;

class SmartClientJwksControllerTest {

    @Test
    void jwksExposesOnlyPublicKeys() throws Exception {
        SmartClientKeyService service = new SmartClientKeyService();
        service.init();
        String body = new SmartClientJwksController(service).jwks().getBody();
        JWKSet set = JWKSet.parse(body);
        assertEquals(2, set.getKeys().size());
        set.getKeys().forEach(k -> assertFalse(k.isPrivate()));
        assertFalse(body.contains("\"d\""));
    }
}
