package org.hl7.davinci.api;

import java.util.List;
import java.util.Map;

import org.hl7.davinci.security.FhirUserDetailsService;
import org.hl7.davinci.security.SecurityProperties;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/api/users", produces = MediaType.APPLICATION_JSON_VALUE)
public class UserController {

    private final FhirUserDetailsService userDetailsService;
    private final SecurityProperties securityProperties;

    public UserController(FhirUserDetailsService userDetailsService, SecurityProperties securityProperties) {
        this.userDetailsService = userDetailsService;
        this.securityProperties = securityProperties;
    }

    @GetMapping
    public List<Map<String, String>> listUsers() {
        String defaultPassword = securityProperties.getDefaultUserPassword();
        return userDetailsService.getAllUsers().stream()
            .map(user -> Map.of(
                "username", user.getUsername(),
                "password", defaultPassword,
                "displayName", user.getDisplayName(),
                "fhirResource", user.getFhirResourceReference(),
                "resourceType", user.getFhirResourceType()
            ))
            .toList();
    }
}
