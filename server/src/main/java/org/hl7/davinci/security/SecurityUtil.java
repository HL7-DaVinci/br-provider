package org.hl7.davinci.security;

import java.net.URI;
import java.net.http.HttpClient;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class SecurityUtil {

    private static final Logger logger = LoggerFactory.getLogger(SecurityUtil.class);

    private static final HttpClient DEFAULT_CLIENT = HttpClient.newHttpClient();
    private static volatile HttpClient trustAllClient;

    /**
     * Returns a trust-all SSLContext when SSL verification is disabled,
     * or null to indicate the JVM default should be used.
     */
    public static SSLContext getTrustAllSslContext(SecurityProperties securityProperties) {
        if (securityProperties.isSslVerify()) {
            return null;
        }
        try {
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, new TrustManager[]{new X509TrustManager() {
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                public void checkClientTrusted(X509Certificate[] certs, String authType) {}
                public void checkServerTrusted(X509Certificate[] certs, String authType) {}
            }}, new SecureRandom());
            return sslContext;
        } catch (Exception e) {
            logger.warn("Failed to create trust-all SSLContext", e);
            return null;
        }
    }

    /**
     * Returns a cached HttpClient appropriate for the SSL verification setting.
     * Reuses connections across requests to the same host.
     */
    public static HttpClient getHttpClient(SecurityProperties securityProperties) {
        if (securityProperties.isSslVerify()) {
            return DEFAULT_CLIENT;
        }
        HttpClient local = trustAllClient;
        if (local == null) {
            SSLContext sslContext = getTrustAllSslContext(securityProperties);
            if (sslContext == null) {
                return DEFAULT_CLIENT;
            }
            local = HttpClient.newBuilder().sslContext(sslContext).build();
            trustAllClient = local;
        }
        return local;
    }

    public static String resolveIssuer(SecurityProperties securityProperties) {
        String issuer = securityProperties.getIssuer();
        if (issuer == null) {
            return null;
        }
        try {
            URI uri = URI.create(issuer);
            String host = uri.getHost();
            if ("host.docker.internal".equals(host) || "127.0.0.1".equals(host)) {
                return issuer.replace(host, "localhost");
            }
        } catch (Exception e) {
            logger.warn("Failed to resolve issuer hostname", e);
        }
        return issuer;
    }
}
