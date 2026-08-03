package org.hl7.davinci.config;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import jakarta.annotation.PostConstruct;

/**
 * Unified configuration for provider and payer server endpoints.
 * Provider servers form the trusted allowlist for SSRF protection in the BFF proxy.
 * Payer servers configure CRD/DTR/PAS workflow targets.
 *
 * Bound from {@code app.provider-servers} and {@code app.payer-servers} in application.yaml.
 */
@Component
@ConfigurationProperties(prefix = "app")
public class ServerProperties {

    private static final Logger logger = LoggerFactory.getLogger(ServerProperties.class);

    private List<ProviderServer> providerServers = new ArrayList<>();
    private List<PayerServer> payerServers = new ArrayList<>();
    private String providerOrgIdentifier;
    private String providerOrgIdentifierSystem = "http://example.org/fhir/org-identifier";
    private String payerOrgIdentifier = "1234567893";
    /** PAS rest-hook endpoint payers notify. Unset, the frontend derives it from the API base. */
    private String pasNotificationUrl;

    @Value("${hapi.fhir.server_address:http://localhost:8080/fhir}")
    private String localServerAddress;

    private Set<String> trustedProviderUrls;

    public ServerProperties() {}

    /** Test-friendly constructor that bypasses @Value injection. */
    public ServerProperties(String localServerAddress, List<ProviderServer> providerServers) {
        this.localServerAddress = localServerAddress;
        this.providerServers = providerServers != null ? providerServers : new ArrayList<>();
        init();
    }

    @PostConstruct
    void init() {
        trustedProviderUrls = new LinkedHashSet<>();
        trustedProviderUrls.add(UrlMatchUtil.normalizeUrl(localServerAddress));

        for (ProviderServer server : providerServers) {
            if (server.getUrl() != null && !server.getUrl().isBlank()) {
                trustedProviderUrls.add(UrlMatchUtil.normalizeUrl(server.getUrl()));
            }
        }

        logger.info("Trusted provider server URLs: {}", trustedProviderUrls);
    }

    public Set<String> getTrustedProviderUrls() {
        return trustedProviderUrls;
    }

    public String getLocalServerAddress() {
        return UrlMatchUtil.normalizeUrl(localServerAddress);
    }

    public List<ProviderServer> getProviderServers() { return providerServers; }
    public void setProviderServers(List<ProviderServer> providerServers) { this.providerServers = providerServers; }

    public List<PayerServer> getPayerServers() { return payerServers; }
    public void setPayerServers(List<PayerServer> payerServers) { this.payerServers = payerServers; }

    public String getProviderOrgIdentifier() { return providerOrgIdentifier; }
    public void setProviderOrgIdentifier(String v) { this.providerOrgIdentifier = v; }

    public String getProviderOrgIdentifierSystem() { return providerOrgIdentifierSystem; }
    public void setProviderOrgIdentifierSystem(String v) { this.providerOrgIdentifierSystem = v; }

    public String getPayerOrgIdentifier() { return payerOrgIdentifier; }
    public void setPayerOrgIdentifier(String v) { this.payerOrgIdentifier = v; }
    public String getPasNotificationUrl() { return pasNotificationUrl; }
    public void setPasNotificationUrl(String v) { this.pasNotificationUrl = v; }

    /**
     * Returns true if the target URL matches a configured payer server's FHIR URL.
     */
    public boolean isPayerFhirUrl(String targetUrl) {
        return payerServers.stream().anyMatch(p -> {
            String fhirUrl = UrlMatchUtil.normalizeUrl(p.getFhirUrl());
            return UrlMatchUtil.matchesBaseUrl(targetUrl, fhirUrl);
        });
    }

    /**
     * Returns the normalized payer FHIR base URL that matches the target,
     * or the target itself if no configured payer matches.
     */
    public String getPayerFhirBaseUrl(String targetUrl) {
        return payerServers.stream()
            .filter(p -> UrlMatchUtil.matchesBaseUrl(targetUrl,
                UrlMatchUtil.normalizeUrl(p.getFhirUrl())))
            .map(p -> UrlMatchUtil.normalizeUrl(p.getFhirUrl()))
            .findFirst()
            .orElse(targetUrl);
    }

    public ProviderServer findProviderByUrl(String targetUrl) {
        return providerServers.stream()
            .filter(p -> UrlMatchUtil.matchesBaseUrl(targetUrl, UrlMatchUtil.normalizeUrl(p.getUrl())))
            .findFirst()
            .orElse(null);
    }

    public PayerServer findPayerByFhirUrl(String targetUrl) {
        return payerServers.stream()
            .filter(p -> UrlMatchUtil.matchesBaseUrl(targetUrl, UrlMatchUtil.normalizeUrl(p.getFhirUrl())))
            .findFirst()
            .orElse(null);
    }

    /** B2B auth settings for a SMART Backend Services or UDAP client credentials call to a configured target. */
    public record B2bAuthConfig(String authType, String tokenUrl, String clientId) {}

    /** Payer servers are checked before provider servers. */
    public B2bAuthConfig findB2bAuthConfig(String targetUrl) {
        PayerServer payer = findPayerByFhirUrl(targetUrl);
        if (payer != null) {
            return new B2bAuthConfig(payer.getAuthType(), payer.getTokenUrl(), blankToNull(payer.getClientId()));
        }
        ProviderServer provider = findProviderByUrl(targetUrl);
        if (provider != null) {
            return new B2bAuthConfig(provider.getAuthType(), provider.getTokenUrl(),
                blankToNull(provider.getClientId()));
        }
        return null;
    }

    /** A property left empty, such as an unset placeholder, means unconfigured. */
    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    public static class ProviderServer {
        private String name;
        private String url;
        private Boolean requiresAuth;
        private String userClientId;
        private String userClientSecret;
        private String userScopes = "openid fhirUser offline_access user/*.rs";
        /** null when omitted so the auth method can be inferred from the secret. */
        private String userAuthMethod;
        private String authType = "udap";
        private String tokenUrl;
        private String clientId;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }

        public String getUrl() { return url; }
        public void setUrl(String url) { this.url = url; }

        public Boolean getRequiresAuth() { return requiresAuth; }
        public void setRequiresAuth(Boolean requiresAuth) { this.requiresAuth = requiresAuth; }

        @com.fasterxml.jackson.annotation.JsonIgnore
        public String getUserClientId() { return userClientId; }
        public void setUserClientId(String userClientId) { this.userClientId = userClientId; }

        @com.fasterxml.jackson.annotation.JsonIgnore
        public String getUserClientSecret() { return userClientSecret; }
        public void setUserClientSecret(String userClientSecret) { this.userClientSecret = userClientSecret; }

        public String getUserScopes() { return userScopes; }
        public void setUserScopes(String userScopes) { this.userScopes = userScopes; }

        public String getUserAuthMethod() { return userAuthMethod; }
        public void setUserAuthMethod(String userAuthMethod) { this.userAuthMethod = userAuthMethod; }

        /** udap (default) | smart-backend | none. B2B auth for provider-to-provider calls, not the SPA user login above. */
        @com.fasterxml.jackson.annotation.JsonIgnore
        public String getAuthType() { return authType; }
        public void setAuthType(String authType) { this.authType = authType; }

        @com.fasterxml.jackson.annotation.JsonIgnore
        public String getTokenUrl() { return tokenUrl; }
        public void setTokenUrl(String tokenUrl) { this.tokenUrl = tokenUrl; }

        /** Pre-registered with the target server. Asymmetric only, no client secret. */
        @com.fasterxml.jackson.annotation.JsonIgnore
        public String getClientId() { return clientId; }
        public void setClientId(String clientId) { this.clientId = clientId; }
    }

    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
    public static class PayerServer {
        private String name;
        private String cdsUrl;
        private String fhirUrl;
        private Boolean requiresAuth;
        private String authType = "udap";
        private String tokenUrl;
        private String clientId;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }

        public String getCdsUrl() { return cdsUrl; }
        public void setCdsUrl(String cdsUrl) { this.cdsUrl = cdsUrl; }

        public String getFhirUrl() { return fhirUrl; }
        public void setFhirUrl(String fhirUrl) { this.fhirUrl = fhirUrl; }

        public Boolean getRequiresAuth() { return requiresAuth; }
        public void setRequiresAuth(Boolean requiresAuth) { this.requiresAuth = requiresAuth; }

        /** udap (default) | smart-backend | none. */
        @com.fasterxml.jackson.annotation.JsonIgnore
        public String getAuthType() { return authType; }
        public void setAuthType(String authType) { this.authType = authType; }

        /**
         * The only auth type the settings dialog has to know about, because it
         * is the one that needs a Client ID field. Any other type stays hidden
         * so the dialog keeps auto-detecting.
         */
        @com.fasterxml.jackson.annotation.JsonProperty("authMode")
        public String getAuthModeForClient() {
            return "smart-backend".equals(authType) ? "smart-backend" : null;
        }

        @com.fasterxml.jackson.annotation.JsonIgnore
        public String getTokenUrl() { return tokenUrl; }
        public void setTokenUrl(String tokenUrl) { this.tokenUrl = tokenUrl; }

        /** Pre-registered with the payer. Asymmetric only, no client secret. */
        @com.fasterxml.jackson.annotation.JsonIgnore
        public String getClientId() { return clientId; }
        public void setClientId(String clientId) { this.clientId = clientId; }
    }
}
