package org.hl7.davinci.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import org.junit.jupiter.api.Test;

class ServerPropertiesTest {

  @Test
  void findB2bAuthConfigChecksPayersThenProviders() {
    ServerProperties.PayerServer payer = new ServerProperties.PayerServer();
    payer.setName("Smart Payer");
    payer.setFhirUrl("https://x/fhir");
    payer.setAuthType("smart-backend");
    payer.setTokenUrl("https://x/oauth/token");
    payer.setClientId("payer-client");

    ServerProperties.ProviderServer provider = new ServerProperties.ProviderServer();
    provider.setName("Smart Provider");
    provider.setUrl("https://y/fhir");
    provider.setAuthType("smart-backend");
    provider.setTokenUrl("https://y/oauth/token");
    provider.setClientId("provider-client");

    ServerProperties props = new ServerProperties("http://localhost:8080/fhir", List.of(provider));
    props.setPayerServers(List.of(payer));

    assertEquals("smart-backend", props.findB2bAuthConfig("https://x/fhir/Claim/$submit").authType());
    assertEquals("smart-backend", props.findB2bAuthConfig("https://y/fhir/Task").authType());
    assertNull(props.findB2bAuthConfig("https://unknown/fhir"));
  }

  @Test
  void payerJsonExposesSmartBackendAndHidesEveryOtherAuthType() throws Exception {
    com.fasterxml.jackson.databind.ObjectMapper mapper =
        new com.fasterxml.jackson.databind.ObjectMapper();

    ServerProperties.PayerServer smart = new ServerProperties.PayerServer();
    smart.setName("Smart Payer");
    smart.setFhirUrl("https://x/fhir");
    smart.setAuthType("smart-backend");
    smart.setClientId("payer-client");

    ServerProperties.PayerServer udap = new ServerProperties.PayerServer();
    udap.setName("Udap Payer");
    udap.setFhirUrl("https://y/fhir");

    String smartJson = mapper.writeValueAsString(smart);
    assertEquals("smart-backend", mapper.readTree(smartJson).path("authMode").asText());
    // The client id stays server-side even when the auth mode is published.
    assertEquals(false, mapper.readTree(smartJson).has("clientId"));
    assertEquals(false, mapper.readTree(mapper.writeValueAsString(udap)).has("authMode"));
  }
}
