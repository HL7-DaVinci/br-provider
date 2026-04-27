package org.hl7.davinci.security;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
        "/.well-known/openid-configuration",
        "/fhir/.well-known/smart-configuration"
    ));
    private String defaultUserPassword = "test";
    private String externalBaseUrl;
    private String serverBaseUrl;
    private String fhirBaseUrl = "http://localhost:8080/fhir";
    private String smartFhirBaseUrl;
    private String smartPublicClientId = "br-provider-smart-public";
    private String smartPublicClientName = "Da Vinci Provider SMART Public Test Client";
    private List<String> smartPublicRedirectUris = new ArrayList<>(List.of(
        "http://localhost:3000/callback",
        "http://127.0.0.1:3000/callback"
    ));
    private String scope = "openid udap fhirUser profile offline_access";
    private List<String> practitionerScopes = new ArrayList<>(List.of(
        "user/*.cruds"
    ));
    private List<String> patientScopes = new ArrayList<>(List.of(
        "patient/*.rs",
        "patient/Appointment.cruds",
        "patient/QuestionnaireResponse.cruds"
    ));
    /**
     * Non-Patient-compartment resource types that patient-scoped tokens are
     * allowed to read. These are the cross-patient "reference data" resources
     * commonly linked from a chart -- Organization, Practitioner, Location,
     * etc. -- that aren't in any compartment but a patient still needs to
     * resolve to display their own data.
     *
     * Anything not in this list and not in the Patient compartment (or its
     * configured extensions) is denied for patient tokens by default.
     */
    private List<String> referenceDataResources = new ArrayList<>(List.of(
        "Organization",
        "Practitioner",
        "PractitionerRole",
        "Location",
        "HealthcareService",
        "Endpoint",
        "Substance",
        "Medication",
        "MedicationKnowledge",
        "Device",
        "DeviceDefinition"
    ));
    /**
     * Resource types whose patient-compartment membership should be extended
     * with additional FHIR search parameter codes. Some resources (notably
     * Task) reference Patient through search params that the FHIR R4 standard
     * Patient compartment definition omits. Configuring those params here
     * lets HAPI's AuthorizationInterceptor enforce patient-scoped access on
     * those resources via inModifiedCompartment, instead of either denying
     * all patient access or allowing unrestricted access.
     *
     * Keys are FHIR resource type names; values are lists of search parameter
     * codes (e.g., "patient", "subject", "owner") whose target is a Patient
     * reference.
     */
    private Map<String, List<String>> patientCompartmentExtensions = new LinkedHashMap<>(Map.of(
        "Task", List.of("patient", "subject", "owner")
    ));
    private String clientName = "Da Vinci Provider";
    private String authorizationEndpoint;
    private String idpBaseUrl;

    @Value("${hapi.fhir.server_address:http://localhost:8080/fhir}")
    public void deriveServerBaseUrl(String serverAddress) {
        this.fhirBaseUrl = serverAddress.replaceAll("/+$", "");
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

    public String getFhirBaseUrl() { return fhirBaseUrl; }
    public void setFhirBaseUrl(String fhirBaseUrl) { this.fhirBaseUrl = fhirBaseUrl; }

    public String getSmartFhirBaseUrl() {
        return (smartFhirBaseUrl != null && !smartFhirBaseUrl.isBlank())
            ? smartFhirBaseUrl.replaceAll("/+$", "")
            : fhirBaseUrl.replaceAll("/+$", "");
    }
    public void setSmartFhirBaseUrl(String smartFhirBaseUrl) { this.smartFhirBaseUrl = smartFhirBaseUrl; }

    public String getSmartPublicClientId() { return smartPublicClientId; }
    public void setSmartPublicClientId(String smartPublicClientId) { this.smartPublicClientId = smartPublicClientId; }

    public String getSmartPublicClientName() { return smartPublicClientName; }
    public void setSmartPublicClientName(String smartPublicClientName) { this.smartPublicClientName = smartPublicClientName; }

    public List<String> getSmartPublicRedirectUris() { return smartPublicRedirectUris; }
    public void setSmartPublicRedirectUris(List<String> smartPublicRedirectUris) {
        this.smartPublicRedirectUris = smartPublicRedirectUris;
    }

    public String getScope() { return scope; }
    public void setScope(String scope) { this.scope = scope; }

    public List<String> getPractitionerScopes() { return practitionerScopes; }
    public void setPractitionerScopes(List<String> practitionerScopes) { this.practitionerScopes = practitionerScopes; }

    public List<String> getPatientScopes() { return patientScopes; }
    public void setPatientScopes(List<String> patientScopes) { this.patientScopes = patientScopes; }

    public List<String> getReferenceDataResources() { return referenceDataResources; }
    public void setReferenceDataResources(List<String> referenceDataResources) { this.referenceDataResources = referenceDataResources; }

    public Map<String, List<String>> getPatientCompartmentExtensions() { return patientCompartmentExtensions; }
    public void setPatientCompartmentExtensions(Map<String, List<String>> patientCompartmentExtensions) { this.patientCompartmentExtensions = patientCompartmentExtensions; }

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
