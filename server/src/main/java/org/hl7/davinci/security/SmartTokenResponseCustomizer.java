package org.hl7.davinci.security;

import java.text.ParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AccessTokenAuthenticationToken;
import org.springframework.security.oauth2.server.authorization.authentication.OAuth2AccessTokenAuthenticationContext;
import org.springframework.stereotype.Component;

@Component
public class SmartTokenResponseCustomizer
        implements Consumer<OAuth2AccessTokenAuthenticationContext> {

    private static final List<String> SMART_CONTEXT_CLAIMS = List.of(
        "patient",
        "encounter",
        "fhirContext",
        "need_patient_banner",
        "smart_style_url"
    );

    @Override
    public void accept(OAuth2AccessTokenAuthenticationContext context) {
        try {
            OAuth2AccessTokenAuthenticationToken authentication = context.getAuthentication();
            JWTClaimsSet claims = SignedJWT
                .parse(authentication.getAccessToken().getTokenValue())
                .getJWTClaimsSet();

            Map<String, Object> smartContextParameters = new LinkedHashMap<>();
            for (String claimName : SMART_CONTEXT_CLAIMS) {
                Object value = claims.getClaim(claimName);
                if (value != null) {
                    smartContextParameters.put(claimName, value);
                }
            }
            if (!smartContextParameters.isEmpty()) {
                Map<String, Object> additionalParameters = new LinkedHashMap<>(
                    authentication.getAdditionalParameters());
                additionalParameters.putAll(smartContextParameters);
                context.getAccessTokenResponse().additionalParameters(additionalParameters);
            }
        } catch (ParseException ignored) {
            // The token endpoint can still return a valid OAuth response without
            // SMART context parameters if a non-JWT token ever appears here.
        }
    }
}
