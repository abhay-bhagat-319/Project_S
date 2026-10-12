import { AppState, AppStateStatus } from 'react-native';

export type NetworkState = 'CAMPUS_ACTIVE' | 'CAMPUS_CAPTIVE' | 'EXTERNAL_ONLINE' | 'OFFLINE';

export interface CampusGatewayConfig {
  server: string;
  port: number;
  tunnelName: string;
  packageName: string;
}

export const IISERB_VPN_CONFIG: CampusGatewayConfig = {
  server: 'gateway.iiserb.ac.in',
  port: 443,
  tunnelName: 'iiserb',
  packageName: 'com.fortinet.forticlient_vpn',
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Cache-Control': 'no-cache',
};

/**
 * Service governing network reachability, campus intranet detection,
 * captive portal authentication state, and gateway accessibility for the IISER Bhopal Shiksha portal.
 */
export class NetworkReachabilityService {
  private static SHIKSHA_PING_URLS = [
    'https://shiksha.iiserb.ac.in/login/',
    'http://shiksha.iiserb.ac.in',
    'https://shiksha.iiserb.ac.in/favicon.ico',
    'https://shiksha.iiserb.ac.in/',
  ];
  private static PUBLIC_PING_URLS = [
    'https://connectivitycheck.gstatic.com/generate_204',
    'https://www.google.com',
  ];
  private static GATEWAY_PING_URL = 'https://gateway.iiserb.ac.in:443';

  private static currentState: NetworkState = 'CAMPUS_ACTIVE';
  private static lastSuccessfulPingTime = 0;
  private static listeners: Set<(state: NetworkState) => void> = new Set();
  private static isAppStateListenerAttached = false;

  static {
    // Automatically attach AppState listener when service class loads
    if (!NetworkReachabilityService.isAppStateListenerAttached) {
      NetworkReachabilityService.isAppStateListenerAttached = true;
      try {
        AppState.addEventListener('change', (nextState: AppStateStatus) => {
          if (nextState === 'active') {
            // Re-probe immediately when user switches back to the app (e.g. from FortiClient or Wi-Fi settings)
            NetworkReachabilityService.getNetworkState().catch(() => {});
          }
        });
      } catch {}
    }
  }

  /**
   * Subscribe to network state changes across the application
   */
  public static subscribe(listener: (state: NetworkState) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Broadcast state changes to all subscribers
   */
  private static notifyListeners(state: NetworkState) {
    this.currentState = state;
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (e) {
        console.warn('Error in network state listener:', e);
      }
    });
  }

  /**
   * Checks whether a response URL or location indicates an unauthenticated Wi-Fi captive portal
   */
  private static isCaptivePortalRedirect(url?: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('172.16.') ||
      lower.includes(':8090') ||
      lower.includes('fgtauth') ||
      (lower.includes('portal') && !lower.includes('shiksha')) ||
      (lower.includes('login') && lower.includes('gateway.iiserb.ac.in'))
    );
  }

  /**
   * Records a confirmed successful campus intranet connection from any WebView or HTTP response
   */
  public static recordSuccess(): void {
    this.lastSuccessfulPingTime = Date.now();
    if (this.currentState !== 'CAMPUS_ACTIVE') {
      console.log('[NetworkReachabilityService] Transitioned to CAMPUS_ACTIVE');
      this.notifyListeners('CAMPUS_ACTIVE');
    }
  }

  /**
   * Records a confirmed connection failure from WebView or probe
   */
  public static async recordFailure(reason?: string): Promise<NetworkState> {
    console.log(`[NetworkReachabilityService] Intranet unreachable: ${reason || 'Unknown error'}`);
    return await this.getNetworkState();
  }

  /**
   * Fast parallel probe to determine whether the Shiksha intranet is directly reachable,
   * intercepted by a captive portal, or unreachable.
   */
  public static async probeIntranet(timeoutMs = 2000): Promise<'CAMPUS_ACTIVE' | 'CAMPUS_CAPTIVE' | 'UNREACHABLE'> {
    // If verified within the last 45 seconds, assume still reachable
    if (Date.now() - this.lastSuccessfulPingTime < 45000 && this.currentState === 'CAMPUS_ACTIVE') {
      return 'CAMPUS_ACTIVE';
    }

    const probeSingle = async (url: string): Promise<'CAMPUS_ACTIVE' | 'CAMPUS_CAPTIVE'> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: BROWSER_HEADERS,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (this.isCaptivePortalRedirect(res.url)) {
          return 'CAMPUS_CAPTIVE';
        }

        if (res.status > 0) {
          return 'CAMPUS_ACTIVE';
        }
        throw new Error('No status');
      } catch (err: any) {
        clearTimeout(timer);
        const errMsg = String(err?.message || '');
        // If an SSL handshake error occurred trying to connect to shiksha.iiserb.ac.in,
        // it confirms the device reached the institutional server or captive gateway.
        if (
          url.includes('iiserb.ac.in') &&
          (errMsg.includes('SSLHandshakeException') ||
           errMsg.includes('CertPathValidatorException') ||
           errMsg.includes('Trust anchor') ||
           errMsg.includes('certificate'))
        ) {
          return 'CAMPUS_ACTIVE';
        }
        throw err;
      }
    };

    try {
      // Concurrently race endpoints for lowest latency (< 250ms on campus Wi-Fi)
      const result = await Promise.any(
        this.SHIKSHA_PING_URLS.map((url) => probeSingle(url))
      );
      if (result === 'CAMPUS_ACTIVE') {
        this.recordSuccess();
        return 'CAMPUS_ACTIVE';
      }
      if (result === 'CAMPUS_CAPTIVE') {
        this.notifyListeners('CAMPUS_CAPTIVE');
        return 'CAMPUS_CAPTIVE';
      }
    } catch {
      // All intranet probes timed out or rejected
    }

    return 'UNREACHABLE';
  }

  /**
   * Fast probe to verify if the Shiksha intranet is directly reachable
   */
  public static async isShikshaReachable(timeoutMs = 2000): Promise<boolean> {
    const status = await this.probeIntranet(timeoutMs);
    return status === 'CAMPUS_ACTIVE';
  }

  /**
   * Fast probe to verify if general public internet is reachable and not captive-hijacked
   */
  public static async isPublicInternetReachable(timeoutMs = 2000): Promise<'ONLINE' | 'CAMPUS_CAPTIVE' | 'OFFLINE'> {
    const probePublic = async (url: string): Promise<'ONLINE' | 'CAMPUS_CAPTIVE'> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: BROWSER_HEADERS,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (this.isCaptivePortalRedirect(res.url)) {
          return 'CAMPUS_CAPTIVE';
        }

        if (url.includes('generate_204')) {
          if (res.status === 204) {
            return 'ONLINE';
          }
          return 'CAMPUS_CAPTIVE';
        }

        if (res.status > 0) {
          return 'ONLINE';
        }
        throw new Error('No response');
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    };

    try {
      const result = await Promise.any(
        this.PUBLIC_PING_URLS.map((url) => probePublic(url))
      );
      return result;
    } catch {
      return 'OFFLINE';
    }
  }

  /**
   * Probes whether the FortiGate VPN gateway endpoint is reachable
   */
  public static async isGatewayReachable(timeoutMs = 2500): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      await fetch(this.GATEWAY_PING_URL, {
        method: 'GET',
        headers: BROWSER_HEADERS,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the 4-tier network classification:
   * - 'CAMPUS_ACTIVE': Connected to IISERB Wi-Fi or active VPN (Shiksha responds)
   * - 'CAMPUS_CAPTIVE': Connected to campus Wi-Fi, but blocked by captive portal login
   * - 'EXTERNAL_ONLINE': Connected to public internet, but Shiksha is unreachable (Needs Wi-Fi / VPN)
   * - 'OFFLINE': No internet connection whatsoever
   */
  public static async getNetworkState(): Promise<NetworkState> {
    const intranetStatus = await this.probeIntranet(2000);
    if (intranetStatus === 'CAMPUS_ACTIVE') {
      return 'CAMPUS_ACTIVE';
    }
    if (intranetStatus === 'CAMPUS_CAPTIVE') {
      this.notifyListeners('CAMPUS_CAPTIVE');
      return 'CAMPUS_CAPTIVE';
    }

    const publicStatus = await this.isPublicInternetReachable(2000);
    if (publicStatus === 'CAMPUS_CAPTIVE') {
      this.notifyListeners('CAMPUS_CAPTIVE');
      return 'CAMPUS_CAPTIVE';
    }
    if (publicStatus === 'ONLINE') {
      this.notifyListeners('EXTERNAL_ONLINE');
      return 'EXTERNAL_ONLINE';
    }

    this.notifyListeners('OFFLINE');
    return 'OFFLINE';
  }

  public static getCurrentState(): NetworkState {
    return this.currentState;
  }
}


