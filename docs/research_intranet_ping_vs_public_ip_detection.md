# Research: Campus Intranet Ping vs. Public Egress IP Verification

**Target Application:** Project_S (IISER Bhopal Academic Client)  
**Target Module:** `NetworkReachabilityService.ts`  
**Date:** October 2026  
**Status:** Completed Evaluation  

---

## 1. Executive Summary & Concept Disambiguation

The proposal evaluated here states:
> *"If your college network routes all internet traffic through a static institution gateway, the easiest method is to host a tiny API endpoint inside the college intranet (e.g., http://college.edu). From your app, simply ping that internal URL. If it returns a 200 OK, the user is definitely inside the Wi-Fi or securely tunneled via the VPN. If the request times out, they are on an outside network."*

There is an important architectural distinction to make between the two concepts referenced:
1. **Intranet Internal Ping (Current & Proposed In-Campus Endpoint):** Probing an origin hosted inside the private IP space (`10.x.x.x` or `172.16.x.x`) or behind the border firewall.
2. **Public Egress IP Check (Actual Public IP Detection):** Probing an *external* server on the public internet (e.g. `api.ipify.org` or a cloud-hosted edge function) which inspects the socket's client IP to verify whether egress matches the college's autonomous system (ASN) / CIDR block (e.g. IISER Bhopal NKN range `14.139.x.x`).

---

## 2. Our Current Network Detection Architecture

At commit [`f821f14d98c717403bfd63ab5b6105d884690e20`](file:///c:/d/ka/mal/Project/_S/Project_S), network classification is implemented in [`mobile/src/services/NetworkReachabilityService.ts`](file:///c:/d/ka/mal/Project/_S/Project_S/mobile/src/services/NetworkReachabilityService.ts).

### 2.1 State Classification Machine
The service implements a 3-tier classification:
- **`CAMPUS_ACTIVE`**: Directly reachable to `https://shiksha.iiserb.ac.in` (User is either on campus Wi-Fi or actively tunneled through FortiClient VPN).
- **`EXTERNAL_ONLINE`**: Shiksha is unreachable, but public internet (`gstatic.com` / `google.com`) is responding (User is on cellular 4G/5G or home Wi-Fi; app directs them to connect to VPN `gateway.iiserb.ac.in` or Wi-Fi).
- **`OFFLINE`**: No internet interface or public socket responds.

### 2.2 Probing Mechanics
1. **Active Probes:**
   - Probes `SHIKSHA_PING_URLS` (`https://shiksha.iiserb.ac.in/login/`, `favicon.ico`, `/`, and `http://shiksha.iiserb.ac.in/login/`) with an `AbortController` timeout of 2000–3500ms.
   - Any response status (`res.status > 0`, including 200, 301, 302, 401, 403, 500) confirms route reachability to the host.
   - Fallback probe to `PUBLIC_PING_URLS` (`connectivitycheck.gstatic.com/generate_204`, `google.com`) with 2000–2500ms timeout.
2. **Passive Signal Feedback:**
   - `SessionLifecycleManager` and `PortalWebviewScreen` immediately invoke `recordSuccess()` whenever any live authenticated WebView navigation or HTTP sync succeeds.
   - Failures (e.g. `ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_TIMED_OUT`, server 5xx) immediately invoke `recordFailure(reason)`.
3. **Cache Grace Window:**
   - If verified within the last 45 seconds and currently `CAMPUS_ACTIVE`, consecutive calls immediately return `true` without redundant HTTP socket overhead.

---

## 3. Feasibility Analysis of the Proposed Alternatives

### 3.1 Option A: Hosting a Dedicated Internal Intranet Endpoint (e.g., `http://intranet.iiserb.ac.in/ping`)

| Consideration | Technical Reality | Feasibility Rating |
| :--- | :--- | :--- |
| **Infrastructure Ownership** | `Project_S` is a student-led open-source project. Students do not hold admin rights to institute gateway hardware or campus data center servers to deploy and guarantee 99.9% uptime of a custom daemon. | ❌ Low (blocked by institutional bureaucracy) |
| **Redundancy with Existing Infrastructure** | `shiksha.iiserb.ac.in` **is already an internal intranet endpoint**. It is already maintained 24/7 by the computer center, behind the border firewall. | ⚠️ Redundant (we already ping Shiksha) |
| **Captive Portal Pitfalls** | When connecting to campus Wi-Fi before entering credentials into the captive portal gateway (Aruba/FortiGate), port 80/443 traffic is intercepted by a captive portal redirect (HTTP 302 to local gateway). Probing a raw HTTP URL can generate a false positive `200` or `302` response before actual intranet connectivity is authorized. | ⚠️ Risk of false positives |
| **Cleartext HTTP Constraints** | Android 9+ (API 28+) strictly enforces HTTPS. While `usesCleartextTraffic="true"` is set in AndroidManifest, unencrypted HTTP endpoints on public/shared Wi-Fi expose the app to MITM DNS spoofing. | ⚠️ Security risk |

### 3.2 Option B: Actual Public Egress IP Check (External Edge Ping)

How it works:
1. The app makes an HTTPS request to an external edge endpoint (e.g., Cloudflare Worker or `https://api.ipify.org?format=json`).
2. The server returns the client's public egress IP.
3. The app checks if the IP belongs to IISER Bhopal's static public CIDR block (NKN / ERNET subnet).

| Consideration | Strengths | Limitations |
| :--- | :--- | :--- |
| **Reliability** | Zero dependency on internal intranet DNS or timeout hangs on cellular data. External endpoint responds in <200ms. | Does **NOT** detect FortiClient SSL-VPN if the VPN is configured with split-tunneling (where only `10.x.x.x` traffic goes through the gateway, while public web goes through the local ISP). |
| **Maintenance** | Can be hosted on a free Cloudflare Worker. | Subnet changes or student VPN policy changes (e.g. split-tunnel vs full-tunnel) will break detection. |
| **Data Privacy** | Very low overhead. | Third-party IP discovery services can rate-limit or fail. |

### 3.3 Option C: Probing Existing Intranet Gateway & Shiksha (Current Architecture)

| Metric | Evaluation |
| :--- | :--- |
| **Ground Truth Accuracy** | **100%**: The ultimate resource the user needs is `shiksha.iiserb.ac.in`. If Shiksha responds, the user can definitely sync and register courses. If Shiksha does not respond, even if the user is on campus Wi-Fi, the app cannot function anyway. |
| **Zero Additional Infrastructure** | Uses existing production endpoints already monitored by IISER Bhopal IT. |
| **DNS Resolution Delay Risk** | When on cellular networks without VPN, DNS resolution for `shiksha.iiserb.ac.in` can take up to 2.5–3.5s before Android's libc `getaddrinfo` throws `ENOTFOUND`. |

---

## 4. Conclusion & Key Takeaways

1. Probing an internal endpoint is **already what the app does** by querying `https://shiksha.iiserb.ac.in/login/` and `https://gateway.iiserb.ac.in:443`.
2. Deploying a new, separate "tiny API endpoint inside college intranet" offers no functional advantage over probing `shiksha.iiserb.ac.in`, but introduces maintenance overhead and institutional permission blockers.
3. A true "Public Egress IP Check" can be useful as an instantaneous pre-filter (to know if the user is physically on campus Wi-Fi within 150ms), but cannot replace testing `shiksha.iiserb.ac.in` because of split-tunnel VPN setups and captive portal states.
