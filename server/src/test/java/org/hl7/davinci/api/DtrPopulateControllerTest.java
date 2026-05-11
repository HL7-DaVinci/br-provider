package org.hl7.davinci.api;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertSame;

import org.hl7.davinci.config.ServerProperties;
import org.hl7.davinci.security.SecurityProperties;
import org.hl7.davinci.security.SpaAuthController;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.opencds.cqf.fhir.cql.EvaluationSettings;
import org.opencds.cqf.fhir.utility.repository.InMemoryFhirRepository;
import org.opencds.cqf.fhir.utility.repository.RestRepository;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.repository.IRepository;
import ca.uhn.fhir.rest.api.server.IRepositoryFactory;

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
}
