package org.hl7.davinci.security;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class ExpiringRequestCacheTest {

    private final ExpiringRequestCache cache = new ExpiringRequestCache();

    private static MockHttpServletRequest authorizeRequest() {
        var request = new MockHttpServletRequest("GET", "/oauth2/authorize");
        request.setQueryString("client_id=br-provider-smart-public&state=abc");
        return request;
    }

    @Test
    void replaysRecentlySavedRequest() {
        var request = authorizeRequest();
        cache.saveRequest(request, new MockHttpServletResponse());

        var followUp = new MockHttpServletRequest("GET", "/login");
        followUp.setSession(request.getSession());

        assertNotNull(cache.getRequest(followUp, new MockHttpServletResponse()));
    }

    @Test
    void discardsSavedRequestOlderThanMaxAge() {
        var request = authorizeRequest();
        cache.saveRequest(request, new MockHttpServletResponse());

        var session = request.getSession();
        session.setAttribute(
            ExpiringRequestCache.SAVED_AT_ATTRIBUTE,
            Instant.now().minus(ExpiringRequestCache.MAX_AGE).minus(Duration.ofMinutes(1)).toEpochMilli());

        var followUp = new MockHttpServletRequest("GET", "/login");
        followUp.setSession(session);

        assertNull(cache.getRequest(followUp, new MockHttpServletResponse()));
        assertNull(session.getAttribute(ExpiringRequestCache.SAVED_AT_ATTRIBUTE));
    }
}
