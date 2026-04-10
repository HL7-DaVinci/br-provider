package org.hl7.davinci.security;

import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "security")
public class SecurityProperties {

    private boolean enableAuthentication = false;
    private String issuer = "https://localhost:5001";
    private String certFile;
    private String certPassword;
    private String defaultCertPassword = "udap-test";
    private boolean fetchCert = true;
    private int fetchCertRetryAttempts = 10;
    private long fetchCertRetryDelay = 5000;
    private String bypassHeader = "X-Bypass-Auth";
    private boolean sslVerify = false;
    private String oauthClientId = "provider-client";
    private List<String> allowedLocalHosts = new ArrayList<>(List.of(
        "localhost",
        "127.0.0.1",
        "[::1]",
        "host.docker.internal"
    ));
    private List<String> publicEndpoints = new ArrayList<>(List.of(
        "/fhir/metadata",
        "/.well-known/udap",
        "/.well-known/openid-configuration"
    ));
    private String defaultUserPassword = "test";
    private String externalBaseUrl;
    private String serverBaseUrl;
    private String scope = "openid udap fhirUser profile offline_access";
    private String clientName = "Da Vinci Provider";
    private String authorizationEndpoint;
    private String idpBaseUrl;

    @Value("${hapi.fhir.server_address:http://localhost:8080/fhir}")
    public void deriveServerBaseUrl(String serverAddress) {
        if (this.serverBaseUrl == null) {
            this.serverBaseUrl = serverAddress.replaceAll("/fhir/?$", "").replaceAll("/+$", "");
        }
    }

    public boolean isEnableAuthentication() { return enableAuthentication; }
    public void setEnableAuthentication(boolean enableAuthentication) { this.enableAuthentication = enableAuthentication; }

    public String getIssuer() { return issuer; }
    public void setIssuer(String issuer) { this.issuer = issuer; }

    public String getCertFile() { return certFile; }
    public void setCertFile(String certFile) { this.certFile = certFile; }

    public String getCertPassword() { return certPassword; }
    public void setCertPassword(String certPassword) { this.certPassword = certPassword; }

    public String getDefaultCertPassword() { return defaultCertPassword; }
    public void setDefaultCertPassword(String defaultCertPassword) { this.defaultCertPassword = defaultCertPassword; }

    public boolean isFetchCert() { return fetchCert; }
    public void setFetchCert(boolean fetchCert) { this.fetchCert = fetchCert; }

    public int getFetchCertRetryAttempts() { return fetchCertRetryAttempts; }
    public void setFetchCertRetryAttempts(int fetchCertRetryAttempts) { this.fetchCertRetryAttempts = fetchCertRetryAttempts; }

    public long getFetchCertRetryDelay() { return fetchCertRetryDelay; }
    public void setFetchCertRetryDelay(long fetchCertRetryDelay) { this.fetchCertRetryDelay = fetchCertRetryDelay; }

    public String getBypassHeader() { return bypassHeader; }
    public void setBypassHeader(String bypassHeader) { this.bypassHeader = bypassHeader; }

    public boolean isSslVerify() { return sslVerify; }
    public void setSslVerify(boolean sslVerify) { this.sslVerify = sslVerify; }

    public String getOauthClientId() { return oauthClientId; }
    public void setOauthClientId(String oauthClientId) { this.oauthClientId = oauthClientId; }

    public List<String> getAllowedLocalHosts() { return allowedLocalHosts; }
    public void setAllowedLocalHosts(List<String> allowedLocalHosts) { this.allowedLocalHosts = allowedLocalHosts; }

    public List<String> getPublicEndpoints() { return publicEndpoints; }
    public void setPublicEndpoints(List<String> publicEndpoints) { this.publicEndpoints = publicEndpoints; }

    public String getDefaultUserPassword() { return defaultUserPassword; }
    public void setDefaultUserPassword(String defaultUserPassword) { this.defaultUserPassword = defaultUserPassword; }

    public String getExternalBaseUrl() { return externalBaseUrl; }
    public void setExternalBaseUrl(String externalBaseUrl) { this.externalBaseUrl = externalBaseUrl; }

public String getServerBaseUrl() { return serverBaseUrl; }
    public void setServerBaseUrl(String serverBaseUrl) { this.serverBaseUrl = serverBaseUrl; }

    public String getScope() { return scope; }
    public void setScope(String scope) { this.scope = scope; }

    public String getClientName() { return clientName; }
    public void setClientName(String clientName) { this.clientName = clientName; }

    public String getAuthorizationEndpoint() { return authorizationEndpoint; }
    public void setAuthorizationEndpoint(String authorizationEndpoint) { this.authorizationEndpoint = authorizationEndpoint; }

    public String getIdpBaseUrl() { return idpBaseUrl != null ? idpBaseUrl : serverBaseUrl; }
    public void setIdpBaseUrl(String idpBaseUrl) { this.idpBaseUrl = idpBaseUrl; }

    /**
     * Returns the canonical provider base URL (no trailing slashes).
     * Prefers externalBaseUrl when set, falls back to serverBaseUrl.
     */
    public String getProviderBaseUrl() {
        if (externalBaseUrl != null && !externalBaseUrl.isBlank()) {
            return externalBaseUrl.replaceAll("/+$", "");
        }
        return serverBaseUrl;
    }
}
