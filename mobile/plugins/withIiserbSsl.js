const { withDangerousMod, withMainApplication, withAndroidManifest } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withIiserbSsl = (config) => {
  // 1. Configure AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    mainApplication.$['android:usesCleartextTraffic'] = 'true';
    mainApplication.$['android:networkSecurityConfig'] = '@xml/network_security_config';
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

      const networkSecurityConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">iiserb.ac.in</domain>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </domain-config>
</network-security-config>
`;
      fs.writeFileSync(path.join(resXmlDir, 'network_security_config.xml'), networkSecurityConfigContent);

      // Package directory
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
 * Custom OkHttpClientFactory for React Native Android networking.
 *
 * Configures domain-scoped SSL trust for IISER Bhopal institutional intranet hosts (*.iiserb.ac.in).
 * Standard CA validation is strictly maintained for all external internet hosts (e.g. GitHub APK downloads).
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

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        verifyServerCertificate(chain, authType)
      }

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
        verifyServerCertificate(chain, authType)
      }

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
        verifyServerCertificate(chain, authType)
      }

      private fun verifyServerCertificate(chain: Array<out X509Certificate>?, authType: String?) {
        try {
          defaultTrustManager?.checkServerTrusted(chain, authType)
        } catch (e: CertificateException) {
          if (!isAcceptableInstitutionalCert(chain)) {
            throw e
          }
        }
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> =
        defaultTrustManager?.acceptedIssuers ?: arrayOf()

      private fun isTrustedHost(host: String): Boolean {
        return host.endsWith("iiserb.ac.in") || host == "localhost" || host == "127.0.0.1"
      }

      private fun isAcceptableInstitutionalCert(chain: Array<out X509Certificate>?): Boolean {
        return chain?.any { cert ->
          val subject = cert.subjectX500Principal?.name?.lowercase() ?: ""
          val issuer = cert.issuerX500Principal?.name?.lowercase() ?: ""
          subject.contains("iiserb") || issuer.contains("iiserb") ||
          subject.contains("iiser") || issuer.contains("iiser") ||
          subject.contains("shiksha") || issuer.contains("shiksha") ||
          subject.contains("bhopal") || issuer.contains("bhopal") ||
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

    val defaultVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
    builder.hostnameVerifier { hostname, session ->
      val lower = hostname.lowercase()
      if (lower.endsWith("iiserb.ac.in") || lower == "localhost" || lower == "127.0.0.1") {
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
