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
