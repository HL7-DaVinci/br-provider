package org.hl7.davinci.security;

import java.util.concurrent.ConcurrentHashMap;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.stereotype.Component;

@Component
public class MutableRegisteredClientRepository implements RegisteredClientRepository {

    private final ConcurrentHashMap<String, RegisteredClient> clientsById = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> clientIdToId = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> issuerToClientId = new ConcurrentHashMap<>();

    @Override
    public void save(RegisteredClient registeredClient) {
        clientsById.put(registeredClient.getId(), registeredClient);
        clientIdToId.put(registeredClient.getClientId(), registeredClient.getId());
    }

    public void saveWithIssuer(RegisteredClient registeredClient, String issuer) {
        save(registeredClient);
        issuerToClientId.put(issuer, registeredClient.getClientId());
    }

    @Override
    public RegisteredClient findById(String id) {
        return clientsById.get(id);
    }

    @Override
    public RegisteredClient findByClientId(String clientId) {
        String id = clientIdToId.get(clientId);
        return id != null ? clientsById.get(id) : null;
    }

    public RegisteredClient findByIssuer(String issuer) {
        String clientId = issuerToClientId.get(issuer);
        return clientId != null ? findByClientId(clientId) : null;
    }
}
