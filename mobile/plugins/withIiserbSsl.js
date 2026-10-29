const { withDangerousMod, withMainApplication, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withIiserbSsl = (config) => {
  // 1. Configure AndroidManifest.xml (enforce HTTPS; scope custom trust via network_security_config)
  config = withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    mainApplication.$['android:usesCleartextTraffic'] = 'false';
    mainApplication.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return config;
  });

  // 2. Modify MainApplication.kt
  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes('import com.facebook.react.modules.network.OkHttpClientProvider')) {
      contents = contents.replace(
        'import expo.modules.ApplicationLifecycleDispatcher',
        'import com.facebook.react.modules.network.OkHttpClientProvider\nimport expo.modules.ApplicationLifecycleDispatcher'
      );
    }

    if (!contents.includes('OkHttpClientProvider.setOkHttpClientFactory')) {
      contents = contents.replace(
        'super.onCreate()',
        'super.onCreate()\n    // Configure strictly domain-scoped TLS validation for IISERB hosts\n    OkHttpClientProvider.setOkHttpClientFactory(IiserbOkHttpClientFactory())'
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

      const resXmlDir = path.join(androidAppDir, 'res', 'xml');
      if (!fs.existsSync(resXmlDir)) {
        fs.mkdirSync(resXmlDir, { recursive: true });
      }

      // Disallow cleartext traffic and untrusted user CAs in production builds;
      // allow user CAs only inside <debug-overrides> for local development.
      const networkSecurityConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">iiserb.ac.in</domain>
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </domain-config>
    <debug-overrides>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
`;
      fs.writeFileSync(path.join(resXmlDir, 'network_security_config.xml'), networkSecurityConfigContent);

      const packageDir = path.join(androidAppDir, 'java', 'com', 'iiserb', 'project_s');
      if (!fs.existsSync(packageDir)) {
        fs.mkdirSync(packageDir, { recursive: true });
      }

      const factoryContent = `package com.iiserb.project_s

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import java.net.Socket
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import android.util.Base64
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager

/**
 * Custom OkHttpClientFactory for React Native Android networking.
 *
 * Strictly scopes institutional certificate fallback to verified *.iiserb.ac.in connections
 * and enforces standard system CA validation for all external hosts (such as GitHub API/Releases).
 */
class IiserbOkHttpClientFactory : OkHttpClientFactory {

  companion object {
    // Optional SHA-256 SPKI pins (base64) for shiksha.iiserb.ac.in / acad.iiserb.ac.in leaf or intermediate CA.
    // Populate with your institutional CA's exact SPKI SHA-256 pin(s) if the intranet CA is not in the Android system store.
    private val ALLOWED_IISERB_SPKI_PINS = setOf<String>()
  }

  override fun createNewNetworkModuleClient(): OkHttpClient {
    val builder = OkHttpClientProvider.createClientBuilder()
    val defaultTrustManager = getDefaultTrustManager()
    val defaultExtendedTrustManager = defaultTrustManager as? X509ExtendedTrustManager

    val iiserbTrustManager = object : X509ExtendedTrustManager() {
      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        defaultTrustManager?.checkClientTrusted(chain, authType)
          ?: throw CertificateException("No default TrustManager available")
      }

      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
        if (defaultExtendedTrustManager != null) {
          defaultExtendedTrustManager.checkClientTrusted(chain, authType, socket)
        } else {
          defaultTrustManager?.checkClientTrusted(chain, authType)
            ?: throw CertificateException("No default TrustManager available")
        }
      }

      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
        if (defaultExtendedTrustManager != null) {
          defaultExtendedTrustManager.checkClientTrusted(chain, authType, engine)
        } else {
          defaultTrustManager?.checkClientTrusted(chain, authType)
            ?: throw CertificateException("No default TrustManager available")
        }
      }

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        // Without a peer hostname context, strictly require system CA validation
        defaultTrustManager?.checkServerTrusted(chain, authType)
          ?: throw CertificateException("No default TrustManager available")
      }

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
        val peerHost = (socket as? SSLSocket)?.handshakeSession?.peerHost
        verifyServerCertificate(chain, authType, peerHost, socket, null)
      }

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
        val peerHost = engine?.peerHost
        verifyServerCertificate(chain, authType, peerHost, null, engine)
      }

      private fun verifyServerCertificate(
        chain: Array<out X509Certificate>?,
        authType: String?,
        peerHost: String?,
        socket: Socket?,
        engine: SSLEngine?
      ) {
        if (chain.isNullOrEmpty()) {
          throw CertificateException("Certificate chain is empty")
        }

        try {
          if (defaultExtendedTrustManager != null) {
            if (socket != null) {
              defaultExtendedTrustManager.checkServerTrusted(chain, authType, socket)
            } else if (engine != null) {
              defaultExtendedTrustManager.checkServerTrusted(chain, authType, engine)
            } else {
              defaultExtendedTrustManager.checkServerTrusted(chain, authType)
            }
          } else {
            defaultTrustManager?.checkServerTrusted(chain, authType)
              ?: throw CertificateException("No default TrustManager available")
          }
        } catch (e: CertificateException) {
          // NEVER allow fallback trust for non-iiserb.ac.in hosts (e.g., api.github.com)
          if (peerHost == null || !isTrustedIiserbHost(peerHost)) {
            throw e
          }
          if (!isValidPinnedInstitutionalCert(chain, peerHost)) {
            throw e
          }
        }
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> =
        defaultTrustManager?.acceptedIssuers ?: arrayOf()

      private fun isTrustedIiserbHost(host: String): Boolean {
        val lower = host.lowercase().trim()
        return lower == "iiserb.ac.in" || lower.endsWith(".iiserb.ac.in")
      }

      private fun isValidPinnedInstitutionalCert(chain: Array<out X509Certificate>, peerHost: String): Boolean {
        val leaf = chain[0]
        // 1. Every certificate in the chain must be within its validity window
        for (cert in chain) {
          cert.checkValidity()
        }

        // 2. Leaf certificate SAN / CN must match the requested *.iiserb.ac.in hostname
        if (!certificateMatchesHost(leaf, peerHost)) {
          return false
        }

        // 3. If SPKI pins are configured, require a cryptographic SPKI match in the chain
        if (ALLOWED_IISERB_SPKI_PINS.isNotEmpty()) {
          val hasPinnedKey = chain.any { cert ->
            val spkiHash = sha256Base64(cert.publicKey.encoded)
            ALLOWED_IISERB_SPKI_PINS.contains(spkiHash)
          }
          return hasPinnedKey
        }

        return false
      }

      private fun certificateMatchesHost(cert: X509Certificate, host: String): Boolean {
        val lowerHost = host.lowercase().trim()
        val sans = cert.subjectAlternativeNames
        if (sans != null) {
          for (san in sans) {
            if (san.size >= 2 && san[0] == 2) { // dNSName = 2
              val pattern = (san[1] as? String)?.lowercase()?.trim() ?: continue
              if (matchesDnsPattern(lowerHost, pattern)) {
                return true
              }
            }
          }
        }
        return false
      }

      private fun matchesDnsPattern(host: String, pattern: String): Boolean {
        if (host == pattern) return true
        if (pattern.startsWith("*.")) {
          val suffix = pattern.substring(1) // ".iiserb.ac.in"
          return host.endsWith(suffix) && host.length > suffix.length
        }
        return false
      }

      private fun sha256Base64(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return Base64.encodeToString(digest, Base64.NO_WRAP)
      }
    }

    val sslContext = SSLContext.getInstance("TLS").apply {
      init(null, arrayOf<TrustManager>(iiserbTrustManager), SecureRandom())
    }

    builder.sslSocketFactory(sslContext.socketFactory, iiserbTrustManager)

    val defaultVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
    builder.hostnameVerifier { hostname, session ->
      defaultVerifier.verify(hostname, session)
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
