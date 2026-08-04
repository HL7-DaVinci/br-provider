package org.hl7.davinci.security;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import com.nimbusds.jwt.JWTClaimsSet;
import org.hl7.davinci.util.UrlMatchUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Performs UDAP Dynamic Client Registration with UDAP-enabled authorization servers.
 * At startup, registers with the configured primary issuer.
 * The registration is refreshed before each login redirect (subject to a
 * cooldown), so a client_id invalidated by an authorization server database
 * reset heals without restarting this server.
 * Also supports on-demand discovery and registration with custom FHIR servers,
 * caching registrations per-issuer so that multiple resource servers sharing
 * the same authorization server reuse one registration.
 */
@Component
public class UdapClientRegistration {

    private static final Logger logger = LoggerFactory.getLogger(UdapClientRegistration.class);

    private final SecurityProperties securityProperties;
    private final CertificateHolder certificateHolder;
    private final OutboundTargetValidator outboundTargetValidator;
    private final UdapDcrClient dcrClient;

    /** Per-issuer registration cache. Keyed by normalized issuer URL. */
    private final ConcurrentHashMap<String, ServerRegistration> issuerRegistrations = new ConcurrentHashMap<>();

    /** Maps resource server URLs to their discovered issuer URLs. */
    private final ConcurrentHashMap<String, String> serverToIssuerMap = new ConcurrentHashMap<>();

    /** Time of the last successful primary registration, for cooldown coalescing. */
    private volatile Instant lastRegisteredAt;

    private volatile String clientId;
    private volatile String authorizeEndpoint;
    private volatile String tokenEndpoint;
    private volatile String redirectUri;
    private volatile boolean registered = false;

    /** Result of a UDAP Dynamic Client Registration with any server. */
    public record ServerRegistration(
        String clientId,
        String authorizeEndpoint,
        String tokenEndpoint,
        String redirectUri,
        String issuer,
        String userinfoEndpoint
    ) {}

    /** Result of probing a FHIR server for UDAP support with optional automatic DCR. */
    public record DiscoveryResult(
        boolean udapEnabled,
        String issuer,
        String authorizationEndpoint,
        boolean registered,
        boolean tieredOauthSupported
    ) {}

    public UdapClientRegistration(
            SecurityProperties securityProperties,
            CertificateHolder certificateHolder,
            OutboundTargetValidator outboundTargetValidator) {
        this.securityProperties = securityProperties;
        this.certificateHolder = certificateHolder;
        this.outboundTargetValidator = outboundTargetValidator;
        this.dcrClient = new UdapDcrClient(securityProperties, certificateHolder, outboundTargetValidator);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        if (!securityProperties.isEnableAuthentication() || !certificateHolder.ensureInitialized()) {
            logger.info("UDAP client registration skipped (auth disabled or cert not initialized)");
            return;
        }
        try {
            register();
        } catch (Exception e) {
            logger.warn("UDAP client registration failed at startup (will retry on /auth/login): {}", e.getMessage());
        }
    }

    /**
     * Discover the primary issuer's endpoints and register as a UDAP client.
     * Safe to call multiple times; skips if already registered.
     */
    public synchronized void register() throws Exception {
        if (registered) return;
        refreshRegistration();
    }

    /**
     * Performs the full discovery and registration workflow with the primary issuer,
     * replacing any cached registration. Calls within the configured cooldown
     * of the last successful registration are no-ops.
     */
    public synchronized void refreshRegistration() throws Exception {
        if (lastRegisteredAt != null && Instant.now().isBefore(
                lastRegisteredAt.plusSeconds(securityProperties.getRegistrationCooldownSeconds()))) {
            return;
        }

        String issuer = securityProperties.getIssuer().replaceAll("/+$", "");
        String udapUrl = issuer + "/.well-known/udap";

        ServerRegistration result = performRegistration(udapUrl);
        this.clientId = result.clientId();
        this.authorizeEndpoint = result.authorizeEndpoint();
        this.tokenEndpoint = result.tokenEndpoint();
        this.redirectUri = result.redirectUri();
        this.registered = true;
        this.lastRegisteredAt = Instant.now();

        issuerRegistrations.put(UrlMatchUtil.normalizeUrl(issuer), result);
        logger.info("UDAP client registered successfully with client_id: {}", clientId);
    }

    /**
     * Refreshes the registration before a login redirect, falling back to the
     * cached registration if the refresh fails. Throws only when no
     * registration exists at all.
     */
    public void ensureFreshRegistration() throws Exception {
        if (!isRegistered()) {
            register();
            return;
        }
        try {
            refreshRegistration();
        } catch (Exception e) {
            logger.warn("UDAP re-registration failed, using cached registration: {}", e.getMessage());
        }
    }

    /**
     * Probes a FHIR server for UDAP support and performs DCR if the server's
     * issuer has not been registered with yet. Results are cached per-issuer,
     * so multiple resource servers sharing the same authorization server reuse
     * one registration. This method is idempotent.
     */
    public DiscoveryResult discoverAndRegister(String fhirServerUrl) {
        return discoverAndRegister(fhirServerUrl, false);
    }

    /**
     * Variant of {@link #discoverAndRegister(String)} that can force a fresh
     * DCR even when a registration is cached for the server's issuer. If the
     * forced DCR fails, any previously cached registration is retained.
     */
    public DiscoveryResult discoverAndRegister(String fhirServerUrl, boolean forceRegistration) {
        String normalizedUrl = UrlMatchUtil.normalizeUrl(fhirServerUrl);
        String udapUrl = normalizedUrl + "/.well-known/udap";

        try {
            outboundTargetValidator.validate(normalizedUrl);

            UdapDcrClient.UdapMetadata metadata = dcrClient.discoverMetadata(udapUrl);
            if (metadata.authorizeEndpoint() == null || metadata.tokenEndpoint() == null
                    || metadata.registrationEndpoint() == null) {
                return new DiscoveryResult(false, null, null, false, false);
            }
            String normalizedIssuer = UrlMatchUtil.normalizeUrl(metadata.issuer());

            // Detect Tiered OAuth support from UDAP metadata
            boolean tieredOauthSupported = false;
            Object profiles = metadata.raw().get("udap_profiles_supported");
            if (profiles instanceof List<?> profileList) {
                tieredOauthSupported = profileList.contains("udap_to");
            }
            if (!tieredOauthSupported) {
                Object scopes = metadata.raw().get("scopes_supported");
                if (scopes instanceof List<?> scopeList) {
                    tieredOauthSupported = scopeList.contains("udap");
                }
            }

            boolean alreadyRegistered = issuerRegistrations.containsKey(normalizedIssuer);
            if (!alreadyRegistered || forceRegistration) {
                try {
                    ServerRegistration reg = performRegistration(metadata);
                    issuerRegistrations.put(normalizedIssuer, reg);
                    alreadyRegistered = true;
                    logger.info("DCR completed for issuer {} via server {}", normalizedIssuer, normalizedUrl);
                } catch (Exception e) {
                    logger.warn("DCR failed for issuer {}: {}", normalizedIssuer, e.getMessage());
                }
            } else {
                logger.info("Reusing existing registration for issuer {}", normalizedIssuer);
            }

            serverToIssuerMap.put(normalizedUrl, normalizedIssuer);
            return new DiscoveryResult(true, normalizedIssuer, metadata.authorizeEndpoint(),
                alreadyRegistered, tieredOauthSupported);

        } catch (Exception e) {
            logger.debug("UDAP discovery failed for {}: {}", fhirServerUrl, e.getMessage());
            return new DiscoveryResult(false, null, null, false, false);
        }
    }

    /**
     * Returns the cached registration for a FHIR server, looking up via the
     * server-to-issuer mapping. Returns null if the server has not been discovered.
     */
    public ServerRegistration getRegistrationForServer(String fhirServerUrl) {
        String normalizedUrl = UrlMatchUtil.normalizeUrl(fhirServerUrl);
        String issuer = serverToIssuerMap.get(normalizedUrl);
        if (issuer == null) return null;
        return issuerRegistrations.get(issuer);
    }

    /**
     * Core registration logic shared between primary (startup) and per-server (on-demand)
     * registration flows. Discovers UDAP metadata, builds a signed software statement,
     * and performs DCR against the target authorization server.
     */
    private ServerRegistration performRegistration(String udapDiscoveryUrl) throws Exception {
        return performRegistration(dcrClient.discoverMetadata(udapDiscoveryUrl));
    }

    private ServerRegistration performRegistration(UdapDcrClient.UdapMetadata metadata) throws Exception {
        if (metadata.registrationEndpoint() == null || metadata.authorizeEndpoint() == null
                || metadata.tokenEndpoint() == null) {
            throw new RuntimeException("UDAP metadata missing required endpoints");
        }

        logger.info("Discovered endpoints - authorize: {}, token: {}, registration: {}",
            metadata.authorizeEndpoint(), metadata.tokenEndpoint(), metadata.registrationEndpoint());

        String regRedirectUri = buildRedirectUri(securityProperties);

        JWTClaimsSet softwareStatementClaims = dcrClient
            .softwareStatementBase(securityProperties.getServerBaseUrl(), metadata.registrationEndpoint())
            .claim("client_name", securityProperties.getClientName())
            .claim("grant_types", List.of("authorization_code"))
            .claim("response_types", List.of("code"))
            .claim("redirect_uris", List.of(regRedirectUri))
            .claim("scope", buildRegistrationScope())
            .build();

        String regClientId = dcrClient.performDcr(metadata.registrationEndpoint(), softwareStatementClaims);

        logger.info("UDAP client registered with client_id: {} via {}",
            regClientId, metadata.registrationEndpoint());
        return new ServerRegistration(regClientId, metadata.authorizeEndpoint(), metadata.tokenEndpoint(),
            regRedirectUri, metadata.issuer(), metadata.userinfoEndpoint());
    }

    /**
     * Builds the scope string used in the DCR software statement. Includes the
     * configured identity scopes plus the role-based resource scopes the SPA
     * may request after login. The authorization server uses this list to
     * decide which scopes the client is allowed to request at /authorize time;
     * scopes omitted here will be rejected as out-of-bounds even if the SPA
     * later asks for them.
     */
    private String buildRegistrationScope() {
        java.util.LinkedHashSet<String> scopes = new java.util.LinkedHashSet<>();
        for (String s : securityProperties.getScope().split("\\s+")) {
            if (!s.isBlank()) {
                scopes.add(s);
            }
        }
        scopes.addAll(securityProperties.getPractitionerScopes());
        scopes.addAll(securityProperties.getPatientScopes());
        return String.join(" ", scopes);
    }

    public String getClientId() { return clientId; }
    public String getAuthorizeEndpoint() { return authorizeEndpoint; }
    public String getTokenEndpoint() { return tokenEndpoint; }
    public String getRedirectUri() { return redirectUri; }
    public boolean isRegistered() { return registered; }

    /**
     * Builds the SPA's OAuth callback redirect URI from server config, using
     * externalBaseUrl when set (dev mode) and falling back to serverBaseUrl.
     * Shared by UDAP DCR and the SMART authorization branch, neither of
     * which requires a live UDAP registration to compute this URI.
     */
    public static String buildRedirectUri(SecurityProperties securityProperties) {
        String baseUrl = securityProperties.getServerBaseUrl();
        if (!baseUrl.endsWith("/")) {
            baseUrl += "/";
        }
        String externalBaseUrl = securityProperties.getExternalBaseUrl();
        String callbackBase = (externalBaseUrl != null && !externalBaseUrl.isBlank())
            ? externalBaseUrl.replaceAll("/+$", "") + "/"
            : baseUrl;
        return callbackBase + "callback";
    }
}
