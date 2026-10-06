export type NetworkState = 'CAMPUS_ACTIVE' | 'EXTERNAL_ONLINE' | 'OFFLINE';

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
 * and gateway accessibility for the IISER Bhopal Shiksha portal.
 */
export class NetworkReachabilityService {
  private static SHIKSHA_PING_URLS = [
    'https://shiksha.iiserb.ac.in/login/',
    'https://shiksha.iiserb.ac.in/favicon.ico',
    'https://shiksha.iiserb.ac.in/',
    'http://shiksha.iiserb.ac.in/login/',
  ];
  private static PUBLIC_PING_URLS = [
    'https://connectivitycheck.gstatic.com/generate_204',
    'https://www.google.com',
  ];
  private static GATEWAY_PING_URL = 'https://gateway.iiserb.ac.in:443';

  private static currentState: NetworkState = 'CAMPUS_ACTIVE';
  private static lastSuccessfulPingTime = 0;
  private static listeners: Set<(state: NetworkState) => void> = new Set();

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
    const isPublicUp = await this.isPublicInternetReachable(2500);
    const newState: NetworkState = isPublicUp ? 'EXTERNAL_ONLINE' : 'OFFLINE';
    this.notifyListeners(newState);
    return newState;
  }

  /**
   * Fast probe to verify if the Shiksha intranet is directly reachable (Active Wi-Fi or VPN)
   */
  public static async isShikshaReachable(timeoutMs = 3500): Promise<boolean> {
    // If verified within the last 45 seconds, assume still reachable
    if (Date.now() - this.lastSuccessfulPingTime < 45000 && this.currentState === 'CAMPUS_ACTIVE') {
      return true;
    }

    for (const url of this.SHIKSHA_PING_URLS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
          method: 'GET',
          headers: BROWSER_HEADERS,
          signal: controller.signal,
        });
        clearTimeout(timer);
        // Any HTTP response (including 200, 301, 302, 401, 403, 404, 500) confirms Shiksha host is reached
        if (res && res.status > 0) {
          this.recordSuccess();
          return true;
        }
      } catch {
        // Try next fallback URL
      }
    }
    return false;
  }

  /**
   * Fast probe to verify if general public internet is reachable
   */
  public static async isPublicInternetReachable(timeoutMs = 2500): Promise<boolean> {
    for (const url of this.PUBLIC_PING_URLS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
          method: 'GET',
          headers: BROWSER_HEADERS,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res && res.status > 0) {
          return true;
        }
      } catch {
        // Try next
      }
    }
    return false;
  }

  /**
   * Probes whether the FortiGate VPN gateway endpoint is reachable
   */
  public static async isGatewayReachable(timeoutMs = 3000): Promise<boolean> {
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
   * Resolves the 3-tier network classification:
   * - 'CAMPUS_ACTIVE': Connected to IISERB Wi-Fi or active VPN (Shiksha responds)
   * - 'EXTERNAL_ONLINE': Connected to public internet, but Shiksha is unreachable (Needs Wi-Fi / VPN)
   * - 'OFFLINE': No internet connection whatsoever
   */
  public static async getNetworkState(): Promise<NetworkState> {
    const isShikshaUp = await this.isShikshaReachable(3000);
    if (isShikshaUp) {
      return 'CAMPUS_ACTIVE';
    }

    const isPublicUp = await this.isPublicInternetReachable(2000);
    if (isPublicUp) {
      return 'EXTERNAL_ONLINE';
    }

    return 'OFFLINE';
  }

  public static getCurrentState(): NetworkState {
    return this.currentState;
  }
}

