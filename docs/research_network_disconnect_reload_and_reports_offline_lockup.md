# Research: Network Disconnection, Mid-Flight Dropouts, Reports Offline Lockup, and WebView Asymmetry

## Executive Summary

When a user switches away from IISER Bhopal Wi-Fi (e.g., to cellular data, personal hotspot, or disconnecting internet mid-flight), the mobile application enters a locked state:
1. **Pull-to-refresh on Attendance, Courses, or Dashboard** displays an activity spinner that spins for 15–35 seconds and terminates silently without updating data or notifying the user.
2. **Grade Reports (`ReportsScreen`)** displays a static `"No internet connection"` banner and blocks all manual refresh and download attempts with an alert dialog (`"Offline Mode: Internet connection required to refresh reports"`), refusing to make network requests even after reconnecting to the campus intranet.
3. **The Portal WebView (`PortalWebviewScreen`)**, in contrast, loads and functions immediately without failure once back on the campus network.

This research report investigates the root causes across primary source code files ([`HttpPortalClient.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/HttpPortalClient.ts), [`NetworkReachabilityService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/NetworkReachabilityService.ts), [`ReportsScreen.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/ReportsScreen.tsx), [`App.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/App.tsx), and native OkHttp/WebKit configurations), details the architectural mechanics of each failure, and provides a concrete remediation plan.

---

## 1. Symptom Breakdown & Root Cause Matrix

| Symptom | Primary Failing Component | Root Cause Mechanism |
| :--- | :--- | :--- |
| **Reports screen displays "Connect to internet" and blocks actions when back on intranet** | [`ReportsScreen.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/ReportsScreen.tsx#L118-L121) | **Static State Guard Barrier:** `handleManualRefresh()` and `handleOpenReport()` check `networkState === 'OFFLINE'` and immediately return an alert without attempting a probe or network request. Because no request is attempted, reachability is never re-verified. |
| **No auto-recovery when reconnecting to Wi-Fi** | [`NetworkReachabilityService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/NetworkReachabilityService.ts#L48-L60) | **Missing OS Network Listener:** The app lacks `@react-native-community/netinfo` and native `ConnectivityManager` callbacks. Reachability is only probed on `AppState` change (`active`), so changing Wi-Fi in the Android Notification Shade / Quick Settings while remaining in the app triggers zero probes. |
| **Reload keeps spinning for 15–35s and ends silently** | [`App.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/App.tsx#L422-L454), [`HttpPortalClient.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/HttpPortalClient.ts#L271-L398) | **Silent Catch + Compounding Timeouts:** `handleManualRefresh` sets `refreshing = true`, catches errors with only `console.warn()`, and sets `refreshing = false` in `finally`. Mid-flight dropouts encounter a 15s request timeout + 15s session re-auth timeout + 4s network probe timeout (~34s total) before silently stopping. |
| **Stale Session / Auth Failure on Reconnect** | [`HttpPortalClient.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/HttpPortalClient.ts#L481-L595) | **Dead Session Cookie + Cross-Origin Credentials:** When IP addresses change upon reconnecting to Wi-Fi, Shiksha invalidates the PHP session. React Native's `fetch()` cannot read `Set-Cookie` response headers in JS, so `extractCookies()` never captures the new `PHPSESSID`. If confirmation fails, re-auth returns failure. |
| **WebView works flawlessly while native app fails** | [`PortalWebviewScreen.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/PortalWebviewScreen.tsx#L112-L120), [`react-native-webview+13.16.1.patch`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/patches/react-native-webview+13.16.1.patch) | **Independent WebKit Stack + SSL Patch:** WebView does not guard its navigations with `networkState === 'OFFLINE'`. It uses Android's native WebKit network engine, executes `handler.proceed()` on SSL errors, and calls `recordSuccess()` on `handleLoadEnd`, single-handedly reviving `NetworkReachabilityService`. |

---

## 2. In-Depth Root Cause Analysis

### 2.1 The "Reports Offline Lockup" Bug

In [`ReportsScreen.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/ReportsScreen.tsx), lines 118–121:
```typescript
const handleManualRefresh = async () => {
  if (networkState === 'CAMPUS_CAPTIVE') {
    Alert.alert('Wi-Fi Sign-in Required', ...);
    return;
  }
  if (networkState === 'EXTERNAL_ONLINE') {
    Alert.alert('Campus Network Required', ...);
    return;
  }
  if (networkState === 'OFFLINE') {
    Alert.alert('Offline Mode', 'Internet connection required to refresh reports.');
    return;
  }
  // Actual fetch only happens below if all guards pass
  setRefreshing(true);
  try {
    const items = await ReportsService.syncReports();
    setReports(items);
  } ...
};
```
And in `handleOpenReport` (lines 143–171):
```typescript
if (!item.isCached && networkState !== 'CAMPUS_ACTIVE') {
  if (networkState === 'OFFLINE') {
    Alert.alert('Offline Mode', 'Internet connection required to download this report.');
    return;
  }
  ...
}
```

#### The Feedback Loop Breakdown:
1. When internet is disconnected or fails midway, `NetworkReachabilityService.recordFailure()` runs `getNetworkState()`, which fails to ping Shiksha and Google, setting `networkState = 'OFFLINE'`.
2. When the user reconnects to IISERB Wi-Fi, `ReportsScreen`'s local state `networkState` remains `'OFFLINE'`.
3. When the user taps the refresh icon or pulls down to refresh, `handleManualRefresh` inspects `if (networkState === 'OFFLINE')`.
4. It encounters `true` and **immediately returns without triggering any fetch, ping, or probe**.
5. Because no fetch is triggered, `NetworkReachabilityService.recordSuccess()` is never executed.
6. The screen is permanently locked in offline mode until the user navigates to the WebView tab or restarts the app.

---

### 2.2 Absence of Real-Time Network State Listeners

Inspecting [`package.json`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/package.json) reveals:
- `@react-native-community/netinfo` is **not installed**.
- In [`NetworkReachabilityService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/NetworkReachabilityService.ts#L47-L60), the only reachability trigger is:
```typescript
static {
  if (!NetworkReachabilityService.isAppStateListenerAttached) {
    NetworkReachabilityService.isAppStateListenerAttached = true;
    try {
      AppState.addEventListener('change', (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          NetworkReachabilityService.getNetworkState().catch(() => {});
        }
      });
    } catch {}
  }
}
```

#### Consequence:
- If a user toggles Wi-Fi in Android Quick Settings / Control Center or if Wi-Fi reconnects automatically while the app remains open in the foreground, `AppState` remains `'active'`.
- No event is fired to notify the app that the network interface changed from cellular to Wi-Fi.
- Even if the app was backgrounded briefly, `getNetworkState()` probes Shiksha with a strict 2000ms timeout (`probeIntranet(2000)`). On Android, when a device joins an enterprise WPA2 or campus Wi-Fi network, DHCP lease assignment, ARP discovery, and TLS handshake take between 1.5s and 3.5s. Probing at 2000ms immediately on app activation frequently times out, resulting in a false-positive `EXTERNAL_ONLINE` or `OFFLINE` classification.

---

### 2.3 The "Keep Spinning and End" Phenomenon

In [`App.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/App.tsx#L422-L454), manual pull-to-refresh is implemented as:
```typescript
const handleManualRefresh = async (scope: SyncScope = 'ATTENDANCE') => {
  setSyncScope(scope);
  setRefreshing(true);
  try {
    if (scope === 'ATTENDANCE') {
      const fresh = await HttpPortalClient.syncAttendance();
      setAttendanceData(fresh);
      return;
    }
    if (scope === 'REPORTS') {
      await ReportsService.syncReports();
      return;
    }
    if (scope === 'PROFILE') {
      const freshProfile = await HttpPortalClient.syncProfile();
      setProfileData(freshProfile);
      return;
    }
    if (scope === 'COURSES') {
      const freshCourses = await HttpPortalClient.syncCourses();
      setCourses(freshCourses.courses);
      if (freshCourses.courseDetails) {
        setCourseDetails((prev) => ({ ...prev, ...freshCourses.courseDetails }));
      }
      return;
    }
    await startSync(scope, undefined, true);
  } catch (e: any) {
    console.warn('Manual HTTP refresh failed:', e);
  } finally {
    setRefreshing(false);
  }
};
```

#### Why it spins for ~34 seconds:
1. **Primary Request:** `HttpPortalClient.syncAttendance()` calls `this.get('/secure/studentMyCourses')`.
   - Default timeout is `15000ms` ([`HttpPortalClient.ts:77`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/HttpPortalClient.ts#L77)).
   - If the network drops midway or times out, the `AbortController` fires at 15s.
2. **Session Recovery (Re-auth):**
   - If the server redirects to `/login` due to a dropped/invalidated session from the IP change, `executeRequest` triggers `recoverSession()` ([line 332](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/HttpPortalClient.ts#L332)).
   - `recoverSession()` calls `this.login(creds.username, creds.password, 15000)`.
   - That introduces a second 15s timeout.
3. **Failure Diagnostics Probe:**
   - In the catch block of `executeRequest` ([lines 367–378](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/HttpPortalClient.ts#L367-L378)), it runs:
     ```typescript
     const netState = await NetworkReachabilityService.recordFailure(errorMsg);
     ```
   - `recordFailure()` executes `probeIntranet(2000)` (2s) followed by `isPublicInternetReachable(2000)` (2s) = 4s total probe time.
4. **Total Elapsed Time:** 15s + 15s + 4s = **~34 seconds**.
5. **The Silent Ending:**
   - When the error propagates to `handleManualRefresh()`, the catch block executes:
     ```typescript
     } catch (e: any) {
       console.warn('Manual HTTP refresh failed:', e);
     } finally {
       setRefreshing(false);
     }
     ```
   - No `Alert.alert` is shown; no error message is displayed in the UI; `setRefreshing(false)` simply hides the spinner. To the user, it "just keeps spinning and ends."

---

### 2.4 Why the WebView Works Flawlessly

The user noted: *"the webview works flawless"*. This disparity occurs because:
1. **No Pre-Flight Gatekeeper:** [`PortalWebviewScreen.tsx`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/PortalWebviewScreen.tsx) has no guard blocking execution if `networkState === 'OFFLINE'`. It immediately commands Android's Chromium WebKit to load `https://shiksha.iiserb.ac.in/secure/studenthome`.
2. **Direct WebKit SSL Bypass:** Institutional certificates for `shiksha.iiserb.ac.in` are handled via [`patches/react-native-webview+13.16.1.patch`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/patches/react-native-webview+13.16.1.patch):
   ```java
   @Override
   public void onReceivedSslError(final WebView webView, final SslErrorHandler handler, final SslError error) {
       // Proceed for institutional portal SSL certificates
       handler.proceed();
   }
   ```
   WebKit does not reject the TLS handshake.
3. **Healing Mechanism:** When the WebView page completes loading, `handleLoadEnd` executes ([line 116](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/screens/PortalWebviewScreen.tsx#L116)):
   ```typescript
   NetworkReachabilityService.recordSuccess();
   ```
   This transitions `NetworkReachabilityService` back to `'CAMPUS_ACTIVE'`, which unblocks other screens.

---

### 2.5 Probe Storm on In-Flight Dropout

In [`HttpPortalClient.ts:967-1002`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/HttpPortalClient.ts#L967-L1002), attendance synchronization maps all courses concurrently:
```typescript
const items: AttendanceItem[] = await Promise.all(
  courses.map(async (course) => {
    const attRes = await this.getCourseAttendance(course.attendanceArg, roll || '');
    ...
  })
);
```
When internet is turned off midway while 6–8 course attendance requests are in flight:
1. All 6–8 requests fail or abort concurrently.
2. In `executeRequest` catch blocks, **each failing request concurrently calls**:
   ```typescript
   await NetworkReachabilityService.recordFailure(errorMsg);
   ```
3. `recordFailure()` executes `probeIntranet(2000)` which initiates 4 concurrent HTTP probes (`SHIKSHA_PING_URLS`).
4. 6 requests $\times$ 4 probes = **24 concurrent probe HTTP requests** launched onto an already failing or switching network stack.
5. This probe storm exhausts sockets, contaminates DNS resolver caches with negative entries (`ENOTFOUND`), and blocks subsequent requests.

---

## 3. Comprehensive Solution Architecture

To eliminate the lockup, enable seamless network transitions, and make reloads resilient, four targeted architectural improvements are required:

### 3.1 Install `@react-native-community/netinfo` for Native Interface Change Detection
- **What:** Add `@react-native-community/netinfo` to `mobile/package.json`.
- **Why:** Replaces the passive `AppState` listener with Android's native `ConnectivityManager.NetworkCallback`.
- **Behavior:** The moment the device switches network interfaces (e.g., Wi-Fi turned on/off, cell data switch, IP address assignment), `NetInfo.addEventListener` immediately notifies `NetworkReachabilityService` to trigger an active probe without requiring the user to background/foreground the app.

### 3.2 Dynamic Probe-on-Demand in `ReportsScreen` & `App.tsx`
- **What:** Remove hard blocking guards (`if (networkState === 'OFFLINE') return;`).
- **Replacement:** In `handleManualRefresh` (both in `ReportsScreen` and `App.tsx`), if the current state is `OFFLINE` or `EXTERNAL_ONLINE`, perform an immediate fast probe:
  ```typescript
  if (networkState !== 'CAMPUS_ACTIVE') {
    const freshState = await NetworkReachabilityService.getNetworkState();
    if (freshState !== 'CAMPUS_ACTIVE') {
      // Show appropriate alert with helper actions (Launch FortiClient, Wi-Fi settings)
      return;
    }
  }
  ```
- **Why:** If the user is back on campus Wi-Fi, pulling to refresh will automatically re-verify reachability, transition to `CAMPUS_ACTIVE`, and complete the sync.

### 3.3 De-duplicate and Throttle `NetworkReachabilityService.recordFailure`
- **What:** Add in-flight de-duplication to `recordFailure()` and `getNetworkState()` using a shared promise mutex:
  ```typescript
  private static pendingProbePromise: Promise<NetworkState> | null = null;

  public static async recordFailure(reason?: string): Promise<NetworkState> {
    if (this.pendingProbePromise) {
      return this.pendingProbePromise;
    }
    this.pendingProbePromise = (async () => {
      try {
        return await this.getNetworkState();
      } finally {
        this.pendingProbePromise = null;
      }
    })();
    return this.pendingProbePromise;
  }
  ```
- **Why:** When 8 requests fail simultaneously upon network loss, only **one** probe cycle (4 requests) executes instead of 24–32 redundant probes.

### 3.4 User Feedback on Manual Refresh Failures in `App.tsx`
- **What:** In `handleManualRefresh()`, replace silent catch blocks with explicit UI feedback based on the error code:
  - If `PortalHttpError.code === 'CAMPUS_NETWORK_REQUIRED'`: Prompt with FortiClient VPN / Wi-Fi options.
  - If `PortalHttpError.code === 'NETWORK_ERROR'`: Display `"No internet connection. Please check your network."`
  - If `PortalHttpError.code === 'SESSION_EXPIRED'`: Transparently re-authenticate, or prompt re-login if credentials changed.
- **Why:** The spinner will never spin for 30s and disappear without feedback; the user receives immediate clarity and actionable buttons.

### 3.5 Robust Session Recovery with Explicit Cookie Re-Binding
- **What:** In `HttpPortalClient.login()` and `recoverSession()`:
  - Add `credentials: 'include'` to all `fetch()` calls.
  - Reset `activeRequests = 0` and clear `requestQueue` upon network failure to avoid stale slot lockups.
  - Flush cookies or re-authenticate before retrying the original endpoint.

---

## 4. Verification Plan

1. **Mid-Flight Disconnection Test:**
   - Initiate a full sync (`startSync('ALL')`).
   - Midway through sync, toggle Wi-Fi OFF in Android Quick Settings.
   - Verify that all active requests abort within 5–10s, concurrency slots reset cleanly, and `networkState` transitions to `OFFLINE`.
2. **Intranet Reconnect Test:**
   - Toggle Wi-Fi back ON and connect to IISERB Wi-Fi.
   - Pull down to refresh in `ReportsScreen`: Verify the screen auto-probes, clears the offline banner, and refreshes the report list.
   - Pull down to refresh in `AttendanceScreen` / `CoursesScreen`: Verify data refreshes successfully without lingering spinners.
3. **Cellular Network Test:**
   - Disconnect from Wi-Fi and switch to 4G/5G mobile data.
   - Tap refresh: Verify `EXTERNAL_ONLINE` is detected and FortiClient VPN launch prompt is displayed with 1-tap action.
