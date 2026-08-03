package org.hl7.davinci.config;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;
import org.hl7.davinci.security.SecurityProperties;
import org.junit.jupiter.api.Test;

class ConfigControllerTest {

  private ConfigController controller() {
    ServerProperties serverProperties = new ServerProperties("http://localhost:8080/fhir", List.of());
    SecurityProperties securityProperties = new SecurityProperties();
    return new ConfigController(serverProperties, securityProperties);
  }

  @Test
  void emitsOrgIdentifiers() {
    String js = controller().getConfig();
    assertTrue(js.contains("providerOrgIdentifierSystem: \"http://example.org/fhir/org-identifier\""));
    assertTrue(js.contains("payerOrgIdentifier: \"1234567893\""));
  }

  @Test
  void omitsProviderOrgIdentifierWhenUnconfigured() {
    assertFalse(controller().getConfig().contains("providerOrgIdentifier: "));
  }

  @Test
  void emitsProviderOrgIdentifierWhenConfigured() {
    ServerProperties serverProperties = new ServerProperties("http://localhost:8080/fhir", List.of());
    serverProperties.setProviderOrgIdentifier("9999999999");
    String js = new ConfigController(serverProperties, new SecurityProperties()).getConfig();
    assertTrue(js.contains("providerOrgIdentifier: \"9999999999\""));
  }

  @Test
  void neverEmitsSecrets() {
    assertFalse(controller().getConfig().contains("clientSecret"));
  }

  @Test
  void emitsApiBaseUrlAndOmitsDeadKeys() {
    String js = controller().getConfig();
    assertTrue(js.contains("apiBaseUrl: \"http://localhost:8080\""));
    assertFalse(js.contains("providerServers:"));
    assertFalse(js.contains("providerServerUrl"));
  }

  @Test
  void providerUserCredentialsNeverReachConfigJs() {
    ServerProperties.ProviderServer ehr = new ServerProperties.ProviderServer();
    ehr.setName("SMART EHR");
    ehr.setUrl("https://ehr.example.com/fhir");
    ehr.setUserClientId("spa-client");
    ehr.setUserClientSecret("s3cret");
    ServerProperties props = new ServerProperties("http://localhost:8080/fhir", List.of(ehr));
    String js = new ConfigController(props, new SecurityProperties()).getConfig();
    assertFalse(js.contains("s3cret"));
    assertFalse(js.contains("userClientSecret"));
  }

  @Test
  void payerAuthConfigNeverReachesConfigJs() {
    ServerProperties.PayerServer payer = new ServerProperties.PayerServer();
    payer.setName("Smart Payer");
    payer.setCdsUrl("https://payer.example.com/cds-services");
    payer.setFhirUrl("https://payer.example.com/fhir");
    payer.setAuthType("smart-backend");
    payer.setTokenUrl("https://payer.example.com/oauth/token");
    payer.setClientId("provider-ri");
    ServerProperties props = new ServerProperties("http://localhost:8080/fhir", List.of());
    props.setPayerServers(List.of(payer));
    String js = new ConfigController(props, new SecurityProperties()).getConfig();
    assertFalse(js.contains("tokenUrl"));
    assertFalse(js.contains("provider-ri"));
    assertFalse(js.contains("authType"));
  }

  @Test
  void emitsRequiresAuthFlag() {
    ServerProperties.ProviderServer open = new ServerProperties.ProviderServer();
    open.setName("Inferno");
    open.setUrl("http://localhost:4567/fhir");
    open.setRequiresAuth(false);
    ServerProperties serverProperties = new ServerProperties("http://localhost:8080/fhir", List.of(open));
    ConfigController controller = new ConfigController(serverProperties, new SecurityProperties());
    assertTrue(controller.getConfig().contains("\"requiresAuth\":false"));
  }
}
