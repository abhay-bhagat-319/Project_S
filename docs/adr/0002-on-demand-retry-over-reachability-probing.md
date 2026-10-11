# On-Demand HTTP Retry Over Reachability Probing

We eliminate background reachability daemons and multi-tier network probing in favor of direct on-demand HTTP requests and pull-to-refresh retries.

## Context

Prior implementations utilized a centralized `NetworkReachabilityService` that maintained a 4-tier network state machine (`CAMPUS_ACTIVE`, `CAMPUS_CAPTIVE`, `EXTERNAL_ONLINE`, `OFFLINE`), listened to native `NetInfo` interface events, and fired parallel ping probes to Google generate_204, Cloudflare, IISERB VPN, and the Shiksha intranet whenever a request failed or an interface changed.

This introduced significant architectural friction:
1. **Shallow Module & Wide Interface**: The reachability daemon leaked into 9 separate screens and services, requiring callers to manually inspect states, branch UI rendering, and report success/failure.
2. **Probe Cascade Spikes**: Every network drop or transient request timeout spawned an immediate cascade of 4 outbound ping probes, increasing latency and battery drain while spamming the debug logs.
3. **UI Lockup & Spurious Warnings**: Screens blocked users with modal alerts ("Launch FortiClient", "Sign In to Wi-Fi") on transient glitches instead of displaying available offline cached data.

## Decision

1. **Delete Reachability Daemon**: Completely delete `NetworkReachabilityService` and `CampusConnectionHelper`. Remove `@react-native-community/netinfo` dependency.
2. **On-Demand Fetch as Sole Probe**: The HTTP request to `shiksha.iiserb.ac.in` itself serves as the sole test of connectivity. If it succeeds, data is cached and displayed. If it fails or times out, `HttpPortalClient` rejects with a clean `PortalHttpError`.
3. **Silent Cache Preservation on Refresh**: UI screens (`Dashboard`, `Attendance`, `Courses`, `Reports`) preserve cached data on failure and promptly terminate the refresh spinner in `finally { setRefreshing(false); }`. No blocking modal alerts on pull-to-refresh.
4. **Fast Timeout (10s)**: Reduced default HTTP timeout from 15s to 10s so off-campus and offline requests release the pull-to-refresh spinner promptly without hanging.
5. **Direct User Retries**: Network transitions are handled naturally: when the user reconnects to campus Wi-Fi or VPN, pulling down to refresh directly attempts the fetch again.
