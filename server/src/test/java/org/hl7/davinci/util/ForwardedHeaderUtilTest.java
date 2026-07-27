package org.hl7.davinci.util;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.junit.jupiter.api.Assertions.*;

class ForwardedHeaderUtilTest {

    @Test
    void extractsPrefixedHeadersAndStripsPrefix() {
        var request = new MockHttpServletRequest();
        request.addHeader("X-Fwd-X-Api-Key", "abc");
        request.addHeader("Accept", "application/json");

        var forwarded = ForwardedHeaderUtil.extract(request);

        assertEquals(Map.of("X-Api-Key", "abc"), forwarded.headers());
        assertFalse(forwarded.hasAuthorization());
    }

    @Test
    void flagsAuthorizationCaseInsensitively() {
        var request = new MockHttpServletRequest();
        request.addHeader("x-fwd-AUTHORIZATION", "Bearer static-token");

        var forwarded = ForwardedHeaderUtil.extract(request);

        assertTrue(forwarded.hasAuthorization());
        assertEquals("Bearer static-token", forwarded.headers().get("AUTHORIZATION"));
    }

    @Test
    void dropsDisallowedHeaderNames() {
        var request = new MockHttpServletRequest();
        request.addHeader("X-Fwd-Host", "evil.example");
        request.addHeader("X-Fwd-Content-Length", "0");
        request.addHeader("X-Fwd-Connection", "close");
        request.addHeader("X-Fwd-Expect", "100-continue");

        var forwarded = ForwardedHeaderUtil.extract(request);

        assertTrue(forwarded.headers().isEmpty());
    }

    @Test
    void emptyWhenNoPrefixedHeaders() {
        var request = new MockHttpServletRequest();
        request.addHeader("Accept", "application/json");

        var forwarded = ForwardedHeaderUtil.extract(request);

        assertTrue(forwarded.headers().isEmpty());
        assertFalse(forwarded.hasAuthorization());
    }

    @Test
    void containsMatchesCaseInsensitively() {
        var request = new MockHttpServletRequest();
        request.addHeader("X-Fwd-Accept", "application/json");

        var forwarded = ForwardedHeaderUtil.extract(request);

        assertTrue(forwarded.contains("accept"));
        assertTrue(forwarded.contains("Accept"));
        assertTrue(forwarded.contains("ACCEPT"));
        assertFalse(forwarded.contains("Content-Type"));
    }
}
