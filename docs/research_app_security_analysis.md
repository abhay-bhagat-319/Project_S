# Research & Security Audit: Comprehensive Security Analysis of Project_S

**Date:** October 14, 2026  
**Target Application:** Project_S Android App (IISER Bhopal Student Companion)  
**Security Scope:**
- TLS/SSL Configuration & Certificate Validation: [`mobile/plugins/withIiserbSsl.js`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/plugins/withIiserbSsl.js)
- Credential Lifecycle & Storage: [`mobile/src/services/SecureStorageService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/SecureStorageService.ts), [`mobile/src/services/SessionLifecycleManager.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/SessionLifecycleManager.ts)
- Network Transport & Direct HTTP Client: [`mobile/src/services/HttpPortalClient.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/HttpPortalClient.ts)
- WebView Attack Surface & Script Injection: [`mobile/src/screens/PortalWebviewScreen.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/PortalWebviewScreen.tsx), [`mobile/src/services/ScraperService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/ScraperService.ts)
- In-App Updater & Binary Supply-Chain: [`mobile/src/services/UpdateService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/UpdateService.ts), [`.github/workflows/release-apk.yml`](file:///c:/d/ka/mal/Project/_S/Project_S/.github/workflows/release-apk.yml)
- Data at Rest & Privacy: [`mobile/src/services/CacheService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/CacheService.ts)
- Android App Permissions & Manifest: [`mobile/app.json`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/app.json)

---

## 1. Executive Summary

A comprehensive architectural security assessment of Project_S was conducted across all layers: transport security, local data encryption, authentication handling, embedded browser execution, update verification, and permission footprint.

### Overall Security Posture: **MODERATE / ACTIONABLE**
- **Strong Areas:**
  - Hardware-backed encrypted storage for LDAP credentials via `expo-secure-store` (Android Keystore / iOS Keychain).
  - Minimal Android permission footprint (no location, contacts, camera, or external storage read/write permissions).
  - Strict separation of credentials away from debug telemetry.
  - Elimination of multi-WebView background scraping in favor of direct HTTP calls with session recovery mutex locks.
- **Critical Vulnerabilities & Areas of Concern:**
  - **Overly Permissive TLS Trust Manager & Hostname Verifier (High Risk):** Custom OkHttp trust manager and hostname verifier accept any certificate matching generic substrings (e.g. `bhopal`, `iiser`, `sectigo`), creating Man-in-the-Middle (MitM) exposure on rogue Wi-Fi networks.
  - **Global Cleartext Permitted:** `network_security_config.xml` enables cleartext traffic and user-installed CA certificates application-wide.
  - **Unrestricted WebView Origin Policy (Medium Risk):** `originWhitelist={['*']}` in `PortalWebviewScreen` with unauthenticated `onMessage` bridge handling.
  - **Update Integrity Without Cryptographic Checksums (Medium Risk):** In-app updater downloads APKs based solely on size checks without SHA-256 hash or signature pre-validation.

---

## 2. Vulnerability & Threat Assessment Matrix

| ID | Vulnerability / Threat Area | Severity | Impact | Primary Source Reference |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Substring-based SSL/TLS Trust & Hostname Verification Bypass | **HIGH** | Man-in-the-Middle (MitM) credential interception on Wi-Fi | [`withIiserbSsl.js:L146-L181`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/plugins/withIiserbSsl.js#L146-L181) |
| **SEC-02** | Global Cleartext & User-Installed CA Trust | **HIGH** | Eavesdropping on unencrypted traffic & proxy interception | [`withIiserbSsl.js:L51-L67`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/plugins/withIiserbSsl.js#L51-L67), [`app.json:L14`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/app.json#L14) |
| **SEC-03** | Missing Origin Filtering in Portal WebView | **MEDIUM** | Malicious iframe/redirect communicating with React Native bridge | [`PortalWebviewScreen.tsx:L235`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/PortalWebviewScreen.tsx#L235) |
| **SEC-04** | Missing SHA-256 Hash Verification on Auto-Updates | **MEDIUM** | Tampered or corrupted APK delivery if CDN/DNS is compromised | [`UpdateService.ts:L151-L176`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/UpdateService.ts#L151-L176) |
| **SEC-05** | UI-Only Biometric Gating (No Keystore-Level Authentication) | **LOW** | Credentials accessible without fingerprint if app process is inspected | [`SecureStorageService.ts:L11-L27`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/SecureStorageService.ts#L11-L27) |
| **SEC-06** | Plaintext Caching of Academic Grades & PII at Rest | **LOW** | Exposure of CPI, SPI, and Attendance on rooted/extracted devices | [`CacheService.ts:L123-L197`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/CacheService.ts#L123-L197) |

---

## 3. In-Depth Technical Analysis

### A. Network & TLS/SSL Validation (SEC-01, SEC-02)

#### 1. The Substring-Matching Certificate Check
In [`mobile/plugins/withIiserbSsl.js`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/plugins/withIiserbSsl.js#L150-L162), to accommodate IISER Bhopal's institutional SSL certificate on `shiksha.iiserb.ac.in`, the custom `IiserbOkHttpClientFactory` overrides `checkServerTrusted` with:

```kotlin
private fun isAcceptableInstitutionalCert(chain: Array<out X509Certificate>?): Boolean {
  return chain?.any { cert ->
    val subject = cert.subjectX500Principal?.name?.lowercase() ?: ""
    val issuer = cert.issuerX500Principal?.name?.lowercase() ?: ""
    subject.contains("iiserb") || issuer.contains("iiserb") ||
    subject.contains("iiser") || issuer.contains("iiser") ||
    subject.contains("shiksha") || issuer.contains("shiksha") ||
    subject.contains("bhopal") || issuer.contains("bhopal") ||
    subject.contains("fortinet") || issuer.contains("fortigate") ||
    subject.contains("sectigo") || issuer.contains("sectigo")
  } ?: false
}
```

AND the hostname verifier ([`withIiserbSsl.js:L172-L179`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/plugins/withIiserbSsl.js#L172-L179)):
```kotlin
builder.hostnameVerifier { hostname, session ->
  val lower = hostname.lowercase()
  if (lower.endsWith("iiserb.ac.in") || lower == "localhost" || lower == "127.0.0.1") {
    true // Unconditionally trusts any cert presented for iiserb.ac.in!
  } else {
    defaultVerifier.verify(hostname, session)
  }
}
```

#### Why this is vulnerable:
1. **Trivial MitM Impersonation:** An attacker on the same local Wi-Fi network (or a rogue hotspot named "IISERB-Hostel") can generate a self-signed certificate with `CN=bhopal` or `O=iiser`.
2. When the app makes requests to `https://shiksha.iiserb.ac.in`, the OkHttp factory catches `CertificateException`, calls `isAcceptableInstitutionalCert`, sees `"bhopal"` in the subject, and **accepts the rogue certificate**.
3. Because the hostname verifier unconditionally returns `true` for all `*.iiserb.ac.in` domains, TLS terminates on the attacker's machine.
4. The student's cleartext LDAP username and password sent during `POST /ldap_login_progress` ([`HttpPortalClient.ts:L455`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/HttpPortalClient.ts#L455)) can be intercepted.

#### 2. Global Cleartext & User Certificate Anchors
In [`withIiserbSsl.js:L51-L67`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/plugins/withIiserbSsl.js#L51-L67):
```xml
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
```
Setting `cleartextTrafficPermitted="true"` globally allows any component of the app to send unencrypted HTTP traffic over the internet. Furthermore, `<certificates src="user" />` in `<base-config>` trusts all user-installed CA certificates for *every* connection, defeating Android 7.0+ default security protections.

---

### B. WebView Attack Surface & Script Injection (SEC-03)

In [`PortalWebviewScreen.tsx:L228-L256`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/PortalWebviewScreen.tsx#L228-L256):
```tsx
<WebView
  ref={webViewRef}
  source={initialSource}
  javaScriptEnabled={true}
  domStorageEnabled={true}
  sharedCookiesEnabled={true}
  thirdPartyCookiesEnabled={true}
  originWhitelist={['*']}
  onMessage={handleMessage}
  ...
/>
```

#### Why this is a concern:
1. **`originWhitelist={['*']}`:** Allows the WebView to navigate to any external web domain without restriction.
2. **Unvalidated `handleMessage` Origin:**
   ```tsx
   const handleMessage = (event: any) => {
     try {
       const data = JSON.parse(event.nativeEvent.data);
       if (ReportsService.handlePdfMessage(data)) {
         return;
       }
     } catch (e) {}
   };
   ```
   If a student navigates or is redirected to an external site via an unvetted link on Shiksha, any script running on that external domain can call `window.ReactNativeWebView.postMessage(...)`. While `ReportsService.handlePdfMessage` currently only processes PDF Base64 messages, having no origin validation breaks the security boundary between arbitrary web content and React Native.

---

### C. In-App Updates & Binary Verification (SEC-04)

In [`mobile/src/services/UpdateService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/UpdateService.ts):
- Update checks query GitHub Releases API (`https://api.github.com/repos/abhay-bhagat-319/Project_S/releases/latest`).
- Downloaded APKs are stored in `${FileSystem.documentDirectory}updates/Project_S-v{version}.apk`.
- Verification logic in `isApkCached` ([`UpdateService.ts:L151-L176`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/UpdateService.ts#L151-L176)):
  - Verifies file exists.
  - Verifies file size is $\ge 5\text{ MB}$ or $\ge 90\%$ of expected size.
  - **No SHA-256 hash or signature pre-verification is performed.**

#### Security Context:
- **Android OS Protection:** When `IntentLauncher.startActivityAsync` launches the Package Installer, Android OS enforces that the incoming APK must be signed with the exact same certificate as the installed package. If an attacker tampers with the APK or replaces it with a malicious APK, Android refuses to install it (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
- **Residual Risk:** If a user is installing or sideloading for the first time, or if an attacker replaces the binary with an incomplete/corrupt build, the app will execute the installer without warning.

---

### D. Credential Storage & Biometric Architecture (SEC-05)

In [`mobile/src/services/SecureStorageService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/SecureStorageService.ts):
```typescript
async saveCredentials(username: string, password: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_USERNAME, username);
  await SecureStore.setItemAsync(KEY_PASSWORD, password);
}
```

#### Findings:
1. **Hardware-Backed Encryption:** `expo-secure-store` correctly uses the Android Keystore to encrypt the stored SharedPreferences file with AES-256-GCM.
2. **Biometric Decoupling:** Biometric authentication ([`LockScreen.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/LockScreen.tsx)) is implemented as an **application-level UI gate**. The `setItemAsync` call does not pass `requireAuthentication: true`. This means the underlying key in Android Keystore does not require hardware biometric authorization to decrypt. While acceptable for student utility apps, an adversary with root ADB access or debugging privileges on an unlocked device could read the credentials without triggering biometric hardware.

---

### E. Data at Rest & Privacy (SEC-06)

In [`mobile/src/services/CacheService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/CacheService.ts):
- Profile Data (Student Name, Roll Number, Department, CPI/SPI, Passed and Failed courses) is stored in `AsyncStorage`.
- Course Attendance records and date-wise attendance logs are stored in `AsyncStorage`.
- Downloaded PDF Grade Report cards (SGR/CGR) are stored in `FileSystem.documentDirectory` (`reports_docs/*.pdf`).

#### Findings:
- `AsyncStorage` on Android is an unencrypted SQLite database (`RKStorage`) inside the app's private sandbox (`/data/data/com.iiserb.project_s/`).
- Sandboxing prevents other non-root Android apps from reading this data.
- However, for users with rooted devices or shared test devices, personal academic records (SPI/CPI, disciplinary failed course records, roll numbers) are stored in plaintext.

---

### F. Permissions & Attack Surface Review

Reviewing [`mobile/app.json:L15-L20`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/app.json#L15-L20):
```json
"permissions": [
  "INTERNET",
  "ACCESS_NETWORK_STATE",
  "REQUEST_INSTALL_PACKAGES",
  "POST_NOTIFICATIONS"
]
```

#### Assessment: **EXCELLENT / MINIMAL**
- **Zero Dangerous Permissions:** The app does NOT request `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `ACCESS_FINE_LOCATION`, `CAMERA`, `READ_CONTACTS`, or `RECORD_AUDIO`.
- `REQUEST_INSTALL_PACKAGES` is strictly required for the in-app update engine (`UpdateService`).
- `POST_NOTIFICATIONS` is standard Android 13+ requirement for update alerts.

---

## 4. Prioritized Remediation Roadmap

### Priority 1: Secure SSL/TLS Trust & Hostname Verification (Remediates SEC-01 & SEC-02)

#### Mitigation Plan:
Instead of loose substring matching on arbitrary certificate fields, pin the exact public key certificate of the IISER Bhopal Shiksha portal or bundle the institutional intermediate CA in the Android network security config.

1. **Extract IISER Bhopal's specific institutional root/intermediate certificate** and place it in `mobile/android/app/src/main/res/raw/iiserb_ca.crt`.
2. **Scope the Network Security Config strictly to `iiserb.ac.in` domains**:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <network-security-config>
       <!-- External internet traffic: Strict system CAs only, no cleartext -->
       <base-config cleartextTrafficPermitted="false">
           <trust-anchors>
               <certificates src="system" />
           </trust-anchors>
       </base-config>

       <!-- Institutional intranet domain: Allow institutional CA only -->
       <domain-config cleartextTrafficPermitted="false">
           <domain includeSubdomains="true">iiserb.ac.in</domain>
           <trust-anchors>
               <certificates src="system" />
               <certificates src="@raw/iiserb_ca" />
           </trust-anchors>
       </domain-config>
   </network-security-config>
   ```
3. **Remove loose substring verifications** in `IiserbOkHttpClientFactory.kt` and use standard certificate path validation against the institutional anchor.
4. **Enforce strict hostname matching** (`OkHostnameVerifier.INSTANCE.verify(hostname, session)`).

---

### Priority 2: Restrict WebView Origin & Bridge Messaging (Remediates SEC-03)

In [`mobile/src/screens/PortalWebviewScreen.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/PortalWebviewScreen.tsx):
1. **Restrict origin whitelist:**
   ```tsx
   originWhitelist={['https://shiksha.iiserb.ac.in*', 'https://*.iiserb.ac.in*']}
   ```
2. **Filter external navigations** using `onShouldStartLoadWithRequest`:
   ```tsx
   onShouldStartLoadWithRequest={(request) => {
     const isIiserb = request.url.includes('iiserb.ac.in');
     if (!isIiserb) {
       Linking.openURL(request.url); // Open external links in device browser
       return false;
     }
     return true;
   }}
   ```
3. **Verify message origin in `handleMessage`:**
   ```tsx
   const handleMessage = (event: any) => {
     const origin = event.nativeEvent.url || '';
     if (!origin.startsWith('https://shiksha.iiserb.ac.in')) {
       console.warn('[Security] Ignored postMessage from untrusted origin:', origin);
       return;
     }
     // Process trusted bridge message
   };
   ```

---

### Priority 3: Add SHA-256 Checksum Verification to Releases (Remediates SEC-04)

In [`.github/workflows/release-apk.yml`](file:///c:/d/ka/mal/Project/_S/Project_S/.github/workflows/release-apk.yml):
1. Compute SHA-256 hashes during the release build:
   ```bash
   sha256sum ../dist_apks/*.apk > ../dist_apks/SHA256SUMS.txt
   ```
2. Publish `SHA256SUMS.txt` alongside APK assets.
3. In [`UpdateService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/UpdateService.ts), fetch `SHA256SUMS.txt`, compute `Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, fileData)`, and verify the checksum before triggering `installCachedApk`.

---

## 5. Security Checklist for Development & Deployment

- [x] Hardware-backed Keystore/Keychain for credentials (`expo-secure-store`)
- [x] Zero extraneous Android dangerous permissions in `app.json`
- [x] Memory queue concurrency limits protecting server session files
- [x] No plaintext logging of student LDAP passwords in console logs
- [ ] Replace loose substring cert matching with exact CA anchor pinning
- [ ] Disallow global cleartext traffic in `network_security_config.xml`
- [ ] Whitelist `https://shiksha.iiserb.ac.in` origins in `PortalWebviewScreen`
- [ ] Add cryptographic SHA-256 integrity verification to auto-updater
