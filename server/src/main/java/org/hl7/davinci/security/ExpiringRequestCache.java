package org.hl7.davinci.security;

import java.time.Duration;
import java.time.Instant;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.web.savedrequest.HttpSessionRequestCache;
import org.springframework.security.web.savedrequest.SavedRequest;
import org.springframework.stereotype.Component;

/**
 * Drops a saved request once it is too old to belong to the sign-in in progress.
 *
 * An authorization request that sends the user to the login page is saved so the
 * flow can resume afterwards. Without an age limit an abandoned authorization
 * request stays in the session, and the next unrelated login replays it, sending
 * the user to that earlier client's redirect URI with its stale state.
 */
@Component
public class ExpiringRequestCache extends HttpSessionRequestCache {

    static final String SAVED_AT_ATTRIBUTE = "SMART_SAVED_REQUEST_AT";
    static final Duration MAX_AGE = Duration.ofMinutes(5);

    @Override
    public void saveRequest(HttpServletRequest request, HttpServletResponse response) {
        super.saveRequest(request, response);
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.setAttribute(SAVED_AT_ATTRIBUTE, Instant.now().toEpochMilli());
        }
    }

    @Override
    public SavedRequest getRequest(HttpServletRequest request, HttpServletResponse response) {
        if (isExpired(request)) {
            removeRequest(request, response);
            return null;
        }
        return super.getRequest(request, response);
    }

    @Override
    public void removeRequest(HttpServletRequest request, HttpServletResponse response) {
        super.removeRequest(request, response);
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.removeAttribute(SAVED_AT_ATTRIBUTE);
        }
    }

    private static boolean isExpired(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            return false;
        }
        Object savedAt = session.getAttribute(SAVED_AT_ATTRIBUTE);
        if (!(savedAt instanceof Long savedAtMillis)) {
            return false;
        }
        return Instant.ofEpochMilli(savedAtMillis).plus(MAX_AGE).isBefore(Instant.now());
    }
}
