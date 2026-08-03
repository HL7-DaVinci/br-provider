package org.hl7.davinci.api;

import org.hl7.davinci.security.SmartClientKeyService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Publishes the public JWKS for the SMART client signing keys, so payer
 * authorization servers can verify private_key_jwt client assertions.
 */
@RestController
public class SmartClientJwksController {

    private final SmartClientKeyService smartClientKeyService;

    public SmartClientJwksController(SmartClientKeyService smartClientKeyService) {
        this.smartClientKeyService = smartClientKeyService;
    }

    @GetMapping(value = "/api/security/jwks", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> jwks() {
        return ResponseEntity.ok(smartClientKeyService.publicJwkSet().toString());
    }
}
