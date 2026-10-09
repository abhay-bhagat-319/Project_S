import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

/**
 * System and intent helper for opening Wi-Fi settings and launching FortiClient VPN directly.
 */
export class CampusConnectionHelper {
  private static FORTICLIENT_PACKAGES = [
    'com.fortinet.forticlient_vpn',
    'com.fortinet.forticlient',
  ];

  /**
   * Attempts to launch FortiClient VPN app directly via Android intent URI,
   * with fallback to Google Play Store.
   */
  public static async launchFortiClient(): Promise<void> {
    if (Platform.OS === 'android') {
      for (const pkg of this.FORTICLIENT_PACKAGES) {
        try {
          const intentUri = `intent:#Intent;package=${pkg};category=android.intent.category.LAUNCHER;action=android.intent.action.MAIN;end`;
          const canOpen = await Linking.canOpenURL(intentUri);
          if (canOpen) {
            await Linking.openURL(intentUri);
            return;
          }
        } catch {
          // Try next package
        }
      }

      // If intent URI didn't open, try direct Play Store link for FortiClient VPN
      const playStoreUri = `market://details?id=com.fortinet.forticlient_vpn`;
      const webPlayStore = `https://play.google.com/store/apps/details?id=com.fortinet.forticlient_vpn`;
      try {
        const canOpenStore = await Linking.canOpenURL(playStoreUri);
        if (canOpenStore) {
          await Linking.openURL(playStoreUri);
        } else {
          await Linking.openURL(webPlayStore);
        }
      } catch {
        await Linking.openURL(webPlayStore);
      }
    } else {
      // iOS / Web fallback
      await Linking.openURL('https://play.google.com/store/apps/details?id=com.fortinet.forticlient_vpn');
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

  /**
   * Opens system browser to initiate campus Wi-Fi captive portal authentication
   */
  public static async openCaptivePortal(): Promise<void> {
    const urls = [
      'https://gateway.iiserb.ac.in:8090',
      'http://neverssl.com',
      'http://connectivitycheck.gstatic.com/generate_204',
    ];
    for (const url of urls) {
      try {
        const can = await Linking.canOpenURL(url);
        if (can) {
          await Linking.openURL(url);
          return;
        }
      } catch {
        // Try next
      }
    }
    try {
      await Linking.openURL('http://neverssl.com');
    } catch {}
  }
}
