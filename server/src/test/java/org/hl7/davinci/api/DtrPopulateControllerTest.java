package org.hl7.davinci.api;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SpaAuthController;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.opencds.cqf.fhir.cql.EvaluationSettings;
import org.opencds.cqf.fhir.utility.repository.InMemoryFhirRepository;
import org.opencds.cqf.fhir.utility.repository.RestRepository;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.repository.IRepository;
import ca.uhn.fhir.rest.api.server.IRepositoryFactory;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.client.interceptor.BearerTokenAuthInterceptor;
import ca.uhn.fhir.rest.client.interceptor.SimpleRequestHeaderInterceptor;

/**
 * Verifies the BFF/FHIR-server separation: {@link DtrPopulateController}
 * routes patient/clinical retrieves to the active provider FHIR server
 * (header → session → local fallback), not always to the local JPA.
 */
class DtrPopulateControllerTest {

    static final String LOCAL_BASE = "http://fhir.test/fhir";
    static final String REMOTE_BASE = "https://remote.example.com/fhir";

    FhirContext fhirContext;
    ServerProperties serverProperties;
    SecurityProperties securityProperties;
    IRepository localStub;
    IRepositoryFactory repositoryFactory;
    DtrPopulateController controller;

    @BeforeEach
    void setUp() {
        fhirContext = FhirContext.forR4Cached();
        serverProperties = new ServerProperties(LOCAL_BASE, null);
        securityProperties = new SecurityProperties();
        localStub = new InMemoryFhirRepository(fhirContext);
        repositoryFactory = (request) -> localStub;
        controller = new DtrPopulateController(
            fhirContext,
            repositoryFactory,
            EvaluationSettings.getDefault(),
            serverProperties,
            securityProperties,
            null);
    }

    @Test
    void resolveDataRepository_noSession_returnsLocalJpa() {
        var request = new MockHttpServletRequest();
        IRepository repo = controller.resolveDataRepository(request);
        assertSame(localStub, repo,
            "No session → fallback to local → IRepositoryFactory's repo");
    }

    @Test
    void resolveDataRepository_sessionLocalBase_returnsLocalJpa() {
        var session = new MockHttpSession();
        session.setAttribute(SpaAuthController.SESSION_SERVER_URL, LOCAL_BASE);
        var request = new MockHttpServletRequest();
        request.setSession(session);
        IRepository repo = controller.resolveDataRepository(request);
        assertSame(localStub, repo,
            "Session matches local base → IRepositoryFactory's repo");
    }

    @Test
    void resolveDataRepository_sessionRemoteBase_returnsRestRepository() {
        var session = new MockHttpSession();
        session.setAttribute(SpaAuthController.SESSION_SERVER_URL, REMOTE_BASE);
        var request = new MockHttpServletRequest();
        request.setSession(session);
        IRepository repo = controller.resolveDataRepository(request);
        assertInstanceOf(RestRepository.class, repo,
            "Session-bound remote base → RestRepository");
    }

    @Test
    void resolveDataRepository_forwardsHeadersAndStaticAuthorization() {
        var client = mock(IGenericClient.class);
        var context = mock(FhirContext.class);
        when(context.newRestfulGenericClient(REMOTE_BASE)).thenReturn(client);
        controller = new DtrPopulateController(
            context,
            repositoryFactory,
            EvaluationSettings.getDefault(),
            serverProperties,
            securityProperties,
            null);

        var session = new MockHttpSession();
        session.setAttribute(SpaAuthController.SESSION_SERVER_URL, REMOTE_BASE);
        session.setAttribute(SpaAuthController.SESSION_TOKEN_SERVER_URL, REMOTE_BASE);
        session.setAttribute(SpaAuthController.SESSION_ACCESS_TOKEN, "session-token");
        var request = new MockHttpServletRequest();
        request.setSession(session);
        request.addHeader("X-Fwd-X-Api-Key", "secret");
        request.addHeader("X-Fwd-Authorization", "Bearer static-token");

        controller.resolveDataRepository(request);

        var captor = ArgumentCaptor.forClass(Object.class);
        verify(client, times(2)).registerInterceptor(captor.capture());
        var interceptors = captor.getAllValues();
        assertTrue(interceptors.stream()
            .filter(SimpleRequestHeaderInterceptor.class::isInstance)
            .map(SimpleRequestHeaderInterceptor.class::cast)
            .anyMatch(i -> "X-Api-Key".equalsIgnoreCase(i.getHeaderName())
                && "secret".equals(i.getHeaderValue())));
        assertTrue(interceptors.stream()
            .filter(SimpleRequestHeaderInterceptor.class::isInstance)
            .map(SimpleRequestHeaderInterceptor.class::cast)
            .anyMatch(i -> "Authorization".equalsIgnoreCase(i.getHeaderName())
                && "Bearer static-token".equals(i.getHeaderValue())));
        assertFalse(interceptors.stream().anyMatch(BearerTokenAuthInterceptor.class::isInstance));
    }
}
