package org.hl7.davinci.security;

import java.util.Collection;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import ca.uhn.fhir.jpa.api.dao.DaoRegistry;
import ca.uhn.fhir.jpa.api.dao.IFhirResourceDao;
import ca.uhn.fhir.jpa.searchparam.SearchParameterMap;
import ca.uhn.fhir.rest.api.server.IBundleProvider;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.HumanName;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Practitioner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class FhirUserDetailsService implements UserDetailsService {

    private static final Logger logger = LoggerFactory.getLogger(FhirUserDetailsService.class);
    private final ConcurrentHashMap<String, FhirUserDetails> users = new ConcurrentHashMap<>();
    private final DaoRegistry daoRegistry;
    private final SecurityProperties securityProperties;

    public FhirUserDetailsService(DaoRegistry daoRegistry, SecurityProperties securityProperties) {
        this.daoRegistry = daoRegistry;
        this.securityProperties = securityProperties;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void scanFhirResources() {
        String password = "{noop}" + securityProperties.getDefaultUserPassword();

        scanResourceType(Practitioner.class, "PRACTITIONER", password);
        scanResourceType(Patient.class, "PATIENT", password);

        logger.info("Registered {} login accounts from FHIR seed data", users.size());
    }

    private <T extends IBaseResource> void scanResourceType(
            Class<T> resourceClass, String role, String password) {
        try {
            IFhirResourceDao<T> dao = daoRegistry.getResourceDao(resourceClass);
            SearchParameterMap params = new SearchParameterMap();
            params.setCount(500);
            IBundleProvider results = dao.search(params, null);

            for (IBaseResource resource : results.getAllResources()) {
                String id = resource.getIdElement().getIdPart();
                String resourceType = resource.fhirType();
                String fhirRef = resourceType + "/" + id;
                String displayName = extractDisplayName(resource);

                users.put(id, new FhirUserDetails(
                    id,
                    password,
                    fhirRef,
                    displayName,
                    List.of(new SimpleGrantedAuthority("ROLE_" + role))
                ));
                logger.info("Registered user: {} -> {} ({})", id, fhirRef, displayName);
            }
        } catch (Exception e) {
            logger.warn("Failed to scan {} resources: {}", resourceClass.getSimpleName(), e.getMessage());
        }
    }

    private String extractDisplayName(IBaseResource resource) {
        List<HumanName> names = null;
        if (resource instanceof Practitioner p) {
            names = p.getName();
        } else if (resource instanceof Patient p) {
            names = p.getName();
        }
        if (names != null && !names.isEmpty()) {
            HumanName name = names.get(0);
            if (name.hasText()) return name.getText();
            String given = name.hasGiven() ? name.getGivenAsSingleString() : "";
            String family = name.hasFamily() ? name.getFamily() : "";
            return (given + " " + family).trim();
        }
        return resource.getIdElement().getIdPart();
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        FhirUserDetails user = users.get(username);
        if (user == null) {
            throw new UsernameNotFoundException("User not found: " + username);
        }
        // Return a copy so Spring Security's eraseCredentials() doesn't null the stored password
        return new FhirUserDetails(
            user.getUsername(), user.getPassword(), user.getFhirResourceReference(),
            user.getDisplayName(), user.getAuthorities());
    }

    public FhirUserDetails getFhirUser(String username) {
        return users.get(username);
    }

    public Collection<FhirUserDetails> getAllUsers() {
        return users.values();
    }
}
