package org.hl7.davinci.security;

import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.util.HtmlUtils;
import org.springframework.web.util.UriUtils;

@Controller
public class SmartPatientSelectionController {

    private final FhirUserDetailsService userDetailsService;
    private final SmartLaunchService smartLaunchService;

    public SmartPatientSelectionController(
            FhirUserDetailsService userDetailsService,
            SmartLaunchService smartLaunchService) {
        this.userDetailsService = userDetailsService;
        this.smartLaunchService = smartLaunchService;
    }

    @GetMapping(value = "/oauth2/smart/select-patient", produces = "text/html")
    public ResponseEntity<String> selectPatient(
            @RequestParam(value = "patient_id", required = false) String patientId,
            HttpSession session,
            Authentication authentication) {
        String savedQuery = (String) session.getAttribute(
            SmartPatientLaunchContextFilter.SAVED_AUTHORIZATION_QUERY);
        if (!StringUtils.hasText(savedQuery)) {
            return ResponseEntity.badRequest().body("No SMART authorization request is pending.");
        }

        if (StringUtils.hasText(patientId)) {
            if (authentication == null || !authentication.isAuthenticated()) {
                return ResponseEntity.status(401).body("No authenticated user.");
            }
            FhirUserDetails selectedUser = userDetailsService.getFhirUser(patientId);
            if (selectedUser == null || !"Patient".equals(selectedUser.getFhirResourceType())) {
                return ResponseEntity.badRequest().body("Unknown patient.");
            }
            String selectedContext = smartLaunchService.createSelectedPatientContext(
                patientId,
                authentication.getName()
            );
            session.setAttribute(SmartPatientLaunchContextFilter.SELECTED_PATIENT_CONTEXT_TOKEN, selectedContext);
            session.removeAttribute(SmartPatientLaunchContextFilter.SAVED_AUTHORIZATION_QUERY);
            String location = "/oauth2/authorize?" + savedQuery
                + "&" + SmartLaunchService.SELECTED_PATIENT_CONTEXT_PARAMETER + "="
                + UriUtils.encodeQueryParam(selectedContext, StandardCharsets.UTF_8);
            return ResponseEntity.status(302).header(HttpHeaders.LOCATION, location).build();
        }

        String rows = userDetailsService.getAllUsers().stream()
            .filter(user -> "Patient".equals(user.getFhirResourceType()))
            .sorted(Comparator.comparing(FhirUserDetails::getDisplayName))
            .map(SmartPatientSelectionController::patientLink)
            .reduce("", String::concat);

        String username = authentication != null ? authentication.getName() : "";
        String body = """
            <!doctype html>
            <html lang="en">
              <head>
                <meta charset="utf-8">
                <title>Select Patient</title>
                <style>
                  body { font-family: system-ui, sans-serif; margin: 2rem; color: #111827; }
                  main { max-width: 42rem; }
                  a { display: block; padding: .75rem 1rem; border: 1px solid #d1d5db; border-radius: .5rem; margin: .5rem 0; color: #111827; text-decoration: none; }
                  a:hover { background: #f9fafb; }
                  .meta { color: #6b7280; font-size: .875rem; }
                </style>
              </head>
              <body>
                <main>
                  <h1>Select Patient</h1>
                  <p class="meta">Signed in as %s. Choose a patient context to continue the SMART launch.</p>
                  %s
                </main>
              </body>
            </html>
            """.formatted(HtmlUtils.htmlEscape(username), rows);
        return ResponseEntity.ok(body);
    }

    private static String patientLink(FhirUserDetails user) {
        String patientId = user.getUsername();
        String href = "/oauth2/smart/select-patient?patient_id="
            + UriUtils.encodeQueryParam(patientId, StandardCharsets.UTF_8);
        return "<a href=\"" + href + "\">"
            + HtmlUtils.htmlEscape(user.getDisplayName())
            + "<span class=\"meta\"> Patient/" + HtmlUtils.htmlEscape(patientId) + "</span>"
            + "</a>";
    }
}
