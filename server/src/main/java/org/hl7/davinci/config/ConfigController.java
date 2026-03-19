package org.hl7.davinci.config;

import org.hl7.davinci.security.SecurityProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ConfigController {

  @Value("${app.fhir.servers:}")
  private String fhirServersJson;

  @Value("${hapi.fhir.server_address:http://localhost:8080/fhir}")
  private String providerServerUrl;

  private final SecurityProperties securityProperties;

  public ConfigController(SecurityProperties securityProperties) {
    this.securityProperties = securityProperties;
  }

  @GetMapping(value = "/config.js", produces = "application/javascript")
  public String getConfig() {
    String servers = fhirServersJson.isEmpty() ? "[]" : fhirServersJson;
    String providerBaseUrl = providerServerUrl.replaceAll("/fhir/?$", "");

    return "window.APP_CONFIG = { "
        + "fhirServers: " + servers + ", "
        + "providerServerUrl: \"" + providerBaseUrl + "\", "
        + "authEnabled: " + securityProperties.isEnableAuthentication()
        + " };";
  }
}
