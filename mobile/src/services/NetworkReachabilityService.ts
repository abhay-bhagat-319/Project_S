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

/**
 * Service governing network reachability, campus intranet detection,
 * and gateway accessibility for the IISER Bhopal Shiksha portal.
 */
export class NetworkReachabilityService {
  private static SHIKSHA_PING_URL = 'https://shiksha.iiserb.ac.in/login/';
  private static PUBLIC_PING_URL = 'https://www.google.com';
  private static GATEWAY_PING_URL = 'https://gateway.iiserb.ac.in:443';

  /**
   * Fast probe to verify if the Shiksha intranet is directly reachable (Active Wi-Fi or VPN)
   */
  public static async isShikshaReachable(timeoutMs = 2500): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(this.SHIKSHA_PING_URL, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.status < 500;
    } catch {
      return false;
    }
  }

  /**
   * Fast probe to verify if general public internet is reachable
   */
  public static async isPublicInternetReachable(timeoutMs = 2000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      await fetch(this.PUBLIC_PING_URL, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return true;
    } catch {
      return false;
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
        method: 'HEAD',
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
    const isShikshaUp = await this.isShikshaReachable(2500);
    if (isShikshaUp) {
      return 'CAMPUS_ACTIVE';
    }

    const isPublicUp = await this.isPublicInternetReachable(2000);
    if (isPublicUp) {
      return 'EXTERNAL_ONLINE';
    }

    return 'OFFLINE';
  }
}
