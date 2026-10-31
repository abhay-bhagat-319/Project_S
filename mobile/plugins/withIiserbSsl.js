const { withDangerousMod, withMainApplication, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withIiserbSsl = (config) => {
  // 1. Configure AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    // Cleartext policy is governed entirely by network_security_config.xml.
    // We still set this attribute so that Android reads the XML config.
    mainApplication.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    // Remove the legacy blanket usesCleartextTraffic if present — the XML handles per-domain rules.
    delete mainApplication.$['android:usesCleartextTraffic'];
    return config;
  });

  // 2. Modify MainApplication.kt
  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    
    // Add import if not present
    if (!contents.includes('import com.facebook.react.modules.network.OkHttpClientProvider')) {
      contents = contents.replace(
        'import expo.modules.ApplicationLifecycleDispatcher',
        'import com.facebook.react.modules.network.OkHttpClientProvider\nimport expo.modules.ApplicationLifecycleDispatcher'
      );
    }

    // Add OkHttpClientProvider.setOkHttpClientFactory if not present
    if (!contents.includes('OkHttpClientProvider.setOkHttpClientFactory')) {
      contents = contents.replace(
        'super.onCreate()',
        'super.onCreate()\n    // Configure domain-scoped SSL trust for IISERB intranet hosts\n    OkHttpClientProvider.setOkHttpClientFactory(IiserbOkHttpClientFactory())'
      );
    }

    config.modResults.contents = contents;
    return config;
  });

  // 3. Write IiserbOkHttpClientFactory.kt and network_security_config.xml
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidAppDir = path.join(projectRoot, 'android', 'app', 'src', 'main');

      // Ensure res/xml directory exists
      const resXmlDir = path.join(androidAppDir, 'res', 'xml');
      if (!fs.existsSync(resXmlDir)) {
        fs.mkdirSync(resXmlDir, { recursive: true });
      }

      // --- HARDENED network_security_config.xml ---
      // - base-config: cleartext DISABLED, system CAs only (protects external hosts like api.github.com)
      // - domain-config for *.iiserb.ac.in: cleartext ALLOWED (acad.iiserb.ac.in HTTP fallback),
      //   system + user CAs trusted (for FortiGate SSL inspection on campus Wi-Fi)
      // - debug-overrides: user CAs trusted for all domains (enables Charles/Proxyman during development)
      const networkSecurityConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- External internet: strict system CAs only, no cleartext -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <!-- Institutional intranet: allow cleartext (acad.iiserb.ac.in HTTP fallback) and user-installed CAs -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">iiserb.ac.in</domain>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </domain-config>
    <!-- Debug builds only: allow user CAs for proxy debugging -->
    <debug-overrides>
        <trust-anchors>
            <certificates src="user" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
`;
      fs.writeFileSync(path.join(resXmlDir, 'network_security_config.xml'), networkSecurityConfigContent);

      // Package directory
      const packageDir = path.join(androidAppDir, 'java', 'com', 'iiserb', 'project_s');
      if (!fs.existsSync(packageDir)) {
        fs.mkdirSync(packageDir, { recursive: true });
      }

      // --- HARDENED IiserbOkHttpClientFactory.kt ---
      // Key security improvement: the institutional certificate fallback is ONLY applied when
      // the TLS peer hostname is *.iiserb.ac.in. External hosts (api.github.com, etc.) use
      // strict system CA validation with no fallback.
      const factoryContent = `package com.iiserb.project_s

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import java.net.Socket
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager

/**
 * Domain-scoped OkHttp SSL trust factory for IISER Bhopal intranet hosts.
 *
 * Security model:
 * - External hosts (api.github.com, CDNs, etc.): strict system CA validation, no fallback.
 * - Institutional hosts (*.iiserb.ac.in): system CA validation first, falling back to
 *   institutional certificate acceptance if the system check fails. This accommodates
 *   acad.iiserb.ac.in's incomplete certificate chain and campus FortiGate SSL inspection.
 *
 * The institutional fallback checks that at least one certificate in the presented chain
 * has subject/issuer fields matching known IISERB or Sectigo identifiers. This is scoped
 * strictly to *.iiserb.ac.in peer hostnames via the hostname extracted from the SSLSocket
 * or SSLEngine, so it cannot be exploited for external connections.
 */
class IiserbOkHttpClientFactory : OkHttpClientFactory {

  override fun createNewNetworkModuleClient(): OkHttpClient {
    val builder = OkHttpClientProvider.createClientBuilder()

    val defaultTrustManager = getDefaultTrustManager()

    val iiserbTrustManager = object : X509ExtendedTrustManager() {
      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        defaultTrustManager?.checkClientTrusted(chain, authType)
      }

      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
        defaultTrustManager?.checkClientTrusted(chain, authType)
      }

      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
        defaultTrustManager?.checkClientTrusted(chain, authType)
      }

      // --- Server trust: hostname-unaware overload (OkHttp may call this) ---
      // Without a socket/engine we cannot determine the peer host, so we apply
      // the institutional fallback conservatively. OkHttp's hostname verifier
      // (below) provides the second gate that rejects non-IISERB hosts.
      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        verifyServerCertificate(chain, authType, peerHost = null)
      }

      // --- Server trust: hostname-aware overloads ---
      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
        val peerHost = (socket as? SSLSocket)?.let {
          it.handshakeSession?.peerHost ?: it.inetAddress?.hostName
        }
        verifyServerCertificate(chain, authType, peerHost)
      }

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
        val peerHost = engine?.peerHost
        verifyServerCertificate(chain, authType, peerHost)
      }

      /**
       * Core verification: try system CAs first. If that fails AND the peer is an
       * institutional host, check the certificate chain for known IISERB identifiers.
       * For non-institutional hosts (or when peer is unknown), re-throw the original exception.
       */
      private fun verifyServerCertificate(chain: Array<out X509Certificate>?, authType: String?, peerHost: String?) {
        try {
          defaultTrustManager?.checkServerTrusted(chain, authType)
        } catch (e: CertificateException) {
          // Only apply institutional fallback for *.iiserb.ac.in hosts
          val isInstitutional = peerHost != null && isIiserbHost(peerHost)
          if (isInstitutional && isAcceptableInstitutionalCert(chain)) {
            // Certificate accepted for institutional host
            return
          }
          throw e
        }
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> =
        defaultTrustManager?.acceptedIssuers ?: arrayOf()

      /**
       * Returns true if the hostname belongs to the IISERB institutional domain.
       */
      private fun isIiserbHost(host: String): Boolean {
        val lower = host.lowercase()
        return lower.endsWith(".iiserb.ac.in") || lower == "iiserb.ac.in"
      }

      /**
       * Checks if the certificate chain contains identifiers consistent with
       * IISERB's known certificate infrastructure (Sectigo DV certs, FortiGate
       * SSL inspection appliance, institutional naming).
       */
      private fun isAcceptableInstitutionalCert(chain: Array<out X509Certificate>?): Boolean {
        return chain?.any { cert ->
          val subject = cert.subjectX500Principal?.name?.lowercase() ?: ""
          val issuer = cert.issuerX500Principal?.name?.lowercase() ?: ""
          subject.contains("iiserb") || issuer.contains("iiserb") ||
          subject.contains("iiser") || issuer.contains("iiser") ||
          subject.contains("shiksha") || issuer.contains("shiksha") ||
          subject.contains("fortinet") || issuer.contains("fortinet") ||
          subject.contains("fortigate") || issuer.contains("fortigate") ||
          subject.contains("sectigo") || issuer.contains("sectigo")
        } ?: false
      }
    }

    val sslContext = SSLContext.getInstance("TLS").apply {
      init(null, arrayOf<TrustManager>(iiserbTrustManager), SecureRandom())
    }

    builder.sslSocketFactory(sslContext.socketFactory, iiserbTrustManager)

    // Hostname verifier: only bypass default verification for *.iiserb.ac.in
    val defaultVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
    builder.hostnameVerifier { hostname, session ->
      val lower = hostname.lowercase()
      if (lower.endsWith(".iiserb.ac.in") || lower == "iiserb.ac.in") {
        true
      } else {
        defaultVerifier.verify(hostname, session)
      }
    }

    return builder.build()
  }

  private fun getDefaultTrustManager(): X509TrustManager? {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    return factory.trustManagers.firstOrNull { it is X509TrustManager } as? X509TrustManager
  }
}
`;
      fs.writeFileSync(path.join(packageDir, 'IiserbOkHttpClientFactory.kt'), factoryContent);

      return config;
    },
  ]);

  return config;
};

module.exports = withIiserbSsl;
