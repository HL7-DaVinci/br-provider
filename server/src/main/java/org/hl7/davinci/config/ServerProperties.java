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

    public static class ProviderServer {
        private String name;
        private String url;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }

        public String getUrl() { return url; }
        public void setUrl(String url) { this.url = url; }
    }

    public static class PayerServer {
        private String name;
        private String cdsUrl;
        private String fhirUrl;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }

        public String getCdsUrl() { return cdsUrl; }
        public void setCdsUrl(String cdsUrl) { this.cdsUrl = cdsUrl; }

        public String getFhirUrl() { return fhirUrl; }
        public void setFhirUrl(String fhirUrl) { this.fhirUrl = fhirUrl; }
    }
}
