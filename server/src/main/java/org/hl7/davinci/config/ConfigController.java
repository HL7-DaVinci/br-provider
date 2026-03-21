package org.hl7.davinci.config;

import org.hl7.davinci.security.SecurityProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ConfigController {

  private final FhirServerProperties fhirServerProperties;
  private final SecurityProperties securityProperties;

  public ConfigController(FhirServerProperties fhirServerProperties, SecurityProperties securityProperties) {
    this.fhirServerProperties = fhirServerProperties;
    this.securityProperties = securityProperties;
  }

  @GetMapping(value = "/config.js", produces = "application/javascript")
  public String getConfig() {
    String servers = fhirServerProperties.getServersJson();
    String providerBaseUrl = fhirServerProperties.getLocalServerAddress()
        .replaceAll("/fhir/?$", "");

    return "window.APP_CONFIG = { "
        + "fhirServers: " + servers + ", "
        + "providerServerUrl: \"" + providerBaseUrl + "\", "
        + "authEnabled: " + securityProperties.isEnableAuthentication()
        + " };";
  }
}
