package org.hl7.davinci.security;

import java.util.Collection;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.User;

public class FhirUserDetails extends User {

    private final String fhirResourceReference;
    private final String displayName;

    public FhirUserDetails(String username, String password, String fhirResourceReference,
            String displayName, Collection<? extends GrantedAuthority> authorities) {
        super(username, password, authorities);
        this.fhirResourceReference = fhirResourceReference;
        this.displayName = displayName;
    }

    public String getFhirResourceReference() { return fhirResourceReference; }
    public String getDisplayName() { return displayName; }

    public String getFhirResourceType() {
        if (fhirResourceReference == null || !fhirResourceReference.contains("/")) {
            return "Unknown";
        }
        return fhirResourceReference.substring(0, fhirResourceReference.indexOf('/'));
    }
}
