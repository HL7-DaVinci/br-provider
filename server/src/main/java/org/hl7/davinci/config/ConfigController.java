package org.hl7.davinci.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.hl7.davinci.security.SecurityProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ConfigController {

  private static final Logger logger = LoggerFactory.getLogger(ConfigController.class);
  private static final ObjectMapper objectMapper = new ObjectMapper();

  private final ServerProperties serverProperties;
  private final SecurityProperties securityProperties;

  public ConfigController(
      ServerProperties serverProperties,
      SecurityProperties securityProperties) {
    this.serverProperties = serverProperties;
    this.securityProperties = securityProperties;
  }

  @GetMapping(value = "/config.js", produces = "application/javascript")
  public String getConfig() {
    String providerServersJson = serializeProviderServers();
    String apiBaseUrl = serverProperties.getLocalServerAddress()
        .replaceAll("/fhir/?$", "");

    return "window.APP_CONFIG = { "
        + "fhirServers: " + providerServersJson + ", "
        + "payerServers: " + serializePayerServers() + ", "
        + "apiBaseUrl: \"" + apiBaseUrl + "\", "
        + providerOrgIdentifierFragment()
        + pasNotificationUrlFragment()
        + "providerOrgIdentifierSystem: \"" + serverProperties.getProviderOrgIdentifierSystem() + "\", "
        + "payerOrgIdentifier: \"" + serverProperties.getPayerOrgIdentifier() + "\", "
        + "authEnabled: " + securityProperties.isEnableAuthentication()
        + " };";
  }

  /** Emitted only when configured; absent, the frontend derives a per-EHR identifier. */
  private String providerOrgIdentifierFragment() {
    String identifier = serverProperties.getProviderOrgIdentifier();
    if (identifier == null || identifier.isBlank()) {
      return "";
    }
    return "providerOrgIdentifier: \"" + identifier + "\", ";
  }

  /** Emitted only when configured. Absent, the frontend derives it from the API base. */
  private String pasNotificationUrlFragment() {
    String url = serverProperties.getPasNotificationUrl();
    if (url == null || url.isBlank()) {
      return "";
    }
    return "pasNotificationUrl: \"" + url + "\", ";
  }

  private String serializeProviderServers() {
    try {
      return objectMapper.writeValueAsString(serverProperties.getProviderServers());
    } catch (JsonProcessingException e) {
      logger.warn("Failed to serialize provider servers: {}", e.getMessage());
      return "[]";
    }
  }

  private String serializePayerServers() {
    try {
      return objectMapper.writeValueAsString(serverProperties.getPayerServers());
    } catch (JsonProcessingException e) {
      logger.warn("Failed to serialize payer servers: {}", e.getMessage());
      return "[]";
    }
  }
}
