# Project_S

Project_S is an Android client and academic portal companion for IISER Bhopal students, providing offline-first access to grades, attendance, course schedules, and academic reports.

## Language

**Release Asset**:
A compiled Android package (APK) distributed via GitHub Releases or edge CDN.
_Avoid_: Build artifact, binary download, installer package

**Targeted APK**:
An architecture-specific APK (e.g., `arm64-v8a`) stripped of redundant native CPU binaries to minimize payload size.
_Avoid_: Split APK, thin APK, slice

**Universal APK**:
A fallback APK containing native `.so` binaries for all supported Android architectures (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`).
_Avoid_: Fat APK, combined APK, full build

**In-App Update Engine**:
The client-side subsystem (`UpdateService`) that checks for new releases, manages background prefetching, validates integrity, and invokes the Android Package Installer.
_Avoid_: Auto-updater, OTA engine, patcher

**Update Notification**:
A local Android system tray notification alerting the user that a new release is available or downloaded and ready for 1-tap installation.
_Avoid_: Push notification, alert banner, toast

**Targeted Sync Scope**:
An execution domain (`ATTENDANCE`, `COURSES`, `MARKS`, `PROFILE`, `REPORTS`) that directs the portal synchronization engine to fetch only the requested slice of student data, preventing monolithic sync overhead.
_Avoid_: Partial fetch, selective pull, partial scrape

**Priority Marks Streamer**:
A dual-phase marks synchronization mechanism that immediately scrapes and resolves assessment marks for the user-selected course first, while asynchronously queueing and caching the remaining courses in the background.
_Avoid_: Batch fetcher, sequential loader

**PortalSyncEngine**:
The headless synchronization coordinator that oversees authenticated WebView lifecycles, injects scoped micro-adapters with per-request abort timeouts, and dispatches structured domain events.
_Avoid_: Background scraper, WebView driver

**SessionLifecycleManager**:
The authentication and session subsystem that coordinates credential verification, cookie jar sanitization, server-side session termination, and background session recovery.
_Avoid_: Auth helper, login service, cookie manager

