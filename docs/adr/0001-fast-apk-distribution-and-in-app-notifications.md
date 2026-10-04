# Fast APK Distribution and In-App Update Notifications

We distribute Android release updates directly to students via GitHub Releases, splitting builds by ABI architecture and notifying users via local on-device notifications.

## Context

Project_S distributes native Android APK updates directly to students outside the Google Play Store. Universal APKs (~70MB) downloaded directly from GitHub AWS S3 suffered from slow speeds (1–3 MB/s) and cross-region latency. Furthermore, users lacked prompt awareness when new releases were ready to install.

## Decision

1. **ABI Architecture Splitting**: CI compiles targeted `arm64-v8a` APKs (~20MB, 70% smaller) for modern devices alongside a `universal` APK (~70MB) fallback. `UpdateService` dynamically resolves the matching targeted APK directly from GitHub Releases.
2. **Direct High-Speed GitHub Releases Distribution**: Eliminate external CDN/reverse proxy requirements by relying on ABI splitting (reducing file size from ~70MB to ~20MB) and silent client-side background prefetching.
3. **Local Update Notifications**: Use `expo-notifications` for self-contained on-device notifications when an update is downloaded and ready to install. Tapping the notification triggers immediate package installation.
4. **Session-scoped Prompt Dismissal**: Dismissing an update prompt or swiping a notification clears it for the current session only; subsequent app launches continue to prompt until the update is installed.
5. **Unified Non-Blocking Background Downloads**: Remove the distinction between "Download Now" and "Download in Background". A single primary action initiates background downloading that persists when the app is minimized or the update dialog is dismissed.
6. **Persistent Resumable State**: Save `DownloadResumable` snapshots in local storage during active downloads, enabling automatic byte-offset resume if the connection drops or the process is killed.
