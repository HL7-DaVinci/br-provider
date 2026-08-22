package org.hl7.davinci.security;

import java.util.LinkedHashSet;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.stereotype.Component;

@Component
public class MutableRegisteredClientRepository implements RegisteredClientRepository {

    private final ConcurrentHashMap<String, RegisteredClient> clientsById = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> clientIdToId = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> issuerToClientId = new ConcurrentHashMap<>();

    static final int MAX_RECOVERED_CLIENTS = 256;
    private final LinkedHashSet<String> recoveredClientIds = new LinkedHashSet<>();

    // @Lazy breaks the cycle: recovery saves back into this repository.
    // Nullable so tests can construct this repository without a recovery bean.
    private final TieredClientRecovery tieredClientRecovery;

    @Autowired
    public MutableRegisteredClientRepository(@Lazy TieredClientRecovery tieredClientRecovery) {
        this.tieredClientRecovery = tieredClientRecovery;
    }

    public MutableRegisteredClientRepository() {
        this(null);
    }

    @Override
    public void save(RegisteredClient registeredClient) {
        clientsById.put(registeredClient.getId(), registeredClient);
        clientIdToId.put(registeredClient.getClientId(), registeredClient.getId());
    }

    public void saveWithIssuer(RegisteredClient registeredClient, String issuer) {
        save(registeredClient);
        issuerToClientId.put(issuer, registeredClient.getClientId());
        synchronized (recoveredClientIds) {
            recoveredClientIds.remove(registeredClient.getClientId());
        }
    }

    /**
     * Saves a client rebuilt by {@link TieredClientRecovery}. Any decodable
     * client_id can trigger recovery, so these are capped and the oldest is
     * evicted; a later real DCR for the same client lifts the cap for it.
     */
    public void saveRecovered(RegisteredClient registeredClient, String issuer) {
        saveWithIssuer(registeredClient, issuer);
        synchronized (recoveredClientIds) {
            recoveredClientIds.add(registeredClient.getClientId());
            while (recoveredClientIds.size() > MAX_RECOVERED_CLIENTS) {
                String oldest = recoveredClientIds.iterator().next();
                recoveredClientIds.remove(oldest);
                remove(oldest);
            }
        }
    }

    private void remove(String clientId) {
        String id = clientIdToId.remove(clientId);
        if (id != null) {
            clientsById.remove(id);
        }
        issuerToClientId.values().remove(clientId);
    }

    @Override
    public RegisteredClient findById(String id) {
        return clientsById.get(id);
    }

    @Override
    public RegisteredClient findByClientId(String clientId) {
        String id = clientIdToId.get(clientId);
        if (id != null) {
            return clientsById.get(id);
        }
        return tieredClientRecovery != null ? tieredClientRecovery.recover(clientId) : null;
    }

    public RegisteredClient findByIssuer(String issuer) {
        String clientId = issuerToClientId.get(issuer);
        return clientId != null ? findByClientId(clientId) : null;
    }
}
