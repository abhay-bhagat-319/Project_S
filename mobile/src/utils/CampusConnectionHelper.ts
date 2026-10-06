import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';
import { IISERB_VPN_CONFIG } from '../services/NetworkReachabilityService';

/**
 * System and intent helper for opening VPN / Wi-Fi settings and launching FortiClient VPN.
 */
export class CampusConnectionHelper {
  /**
   * Attempts to launch FortiClient VPN app directly, or opens Play Store if not installed
   */
  public static async launchFortiClient(): Promise<void> {
    const { packageName } = IISERB_VPN_CONFIG;

    if (Platform.OS === 'android') {
      try {
        await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
          packageName,
          category: 'android.intent.category.LAUNCHER',
        });
      } catch (e) {
        // Fallback: Open Google Play Store to install/launch FortiClient
        const playStoreUri = `market://details?id=${packageName}`;
        const webPlayStore = `https://play.google.com/store/apps/details?id=${packageName}`;
        try {
          const supported = await Linking.canOpenURL(playStoreUri);
          if (supported) {
            await Linking.openURL(playStoreUri);
          } else {
            await Linking.openURL(webPlayStore);
          }
        } catch {
          await Linking.openURL(webPlayStore);
        }
      }
    } else {
      // iOS fallback or generic web link
      await Linking.openURL('https://play.google.com/store/apps/details?id=com.fortinet.forticlient_vpn');
    }
  }

  /**
   * Opens Android System VPN Settings
   */
  public static async openVpnSettings(): Promise<void> {
    if (Platform.OS === 'android') {
      try {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.VPN_SETTINGS);
      } catch {
        try {
          await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.WIRELESS_SETTINGS);
        } catch {
          await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.SETTINGS);
        }
      }
    }
  }

  /**
   * Opens Android Wi-Fi Settings
   */
  public static async openWifiSettings(): Promise<void> {
    if (Platform.OS === 'android') {
      try {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.WIFI_SETTINGS);
      } catch {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.SETTINGS);
      }
    }
  }
}
