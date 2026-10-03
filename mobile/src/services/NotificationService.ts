import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure notification behavior when app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const UPDATE_NOTIFICATION_CHANNEL_ID = 'app-updates';
const UPDATE_NOTIFICATION_ID = 'project-s-app-update';

export class NotificationService {
  private static isInitialized = false;

  /**
   * Initializes notification channels and permissions for Android
   */
  public static async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(UPDATE_NOTIFICATION_CHANNEL_ID, {
          name: 'App Updates',
          description: 'Notifications for new version updates and installations',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#6366F1',
          showBadge: true,
          sound: 'default',
        });
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      this.isInitialized = finalStatus === 'granted';
      return this.isInitialized;
    } catch (e) {
      console.warn('[NotificationService] Failed to initialize notifications:', e);
      return false;
    }
  }

  /**
   * Sends a local notification when an update has been pre-downloaded and is ready to install
   */
  public static async notifyUpdateReady(version: string, releaseName?: string): Promise<void> {
    try {
      await this.init();
      const title = 'Update Ready to Install 🚀';
      const body = releaseName && releaseName !== `v${version}` && releaseName !== version
        ? `v${version} (${releaseName}) is downloaded. Tap to install now!`
        : `Project_S v${version} has been downloaded. Tap to install now!`;

      await Notifications.scheduleNotificationAsync({
        identifier: UPDATE_NOTIFICATION_ID,
        content: {
          title,
          body,
          data: {
            action: 'INSTALL_UPDATE',
            version,
          },
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          color: '#6366F1',
        },
        trigger: null, // Send immediately
      });
    } catch (err) {
      console.warn('[NotificationService] Failed to show update ready notification:', err);
    }
  }

  /**
   * Sends a local notification when an update is available (before/without prefetch)
   */
  public static async notifyUpdateAvailable(version: string, releaseName?: string): Promise<void> {
    try {
      await this.init();
      const title = 'New Update Available 🌟';
      const body = `Project_S v${version} is now available. Tap to view and update.`;

      await Notifications.scheduleNotificationAsync({
        identifier: UPDATE_NOTIFICATION_ID,
        content: {
          title,
          body,
          data: {
            action: 'OPEN_UPDATE_MODAL',
            version,
          },
          sound: true,
          priority: Notifications.AndroidNotificationPriority.DEFAULT,
          color: '#6366F1',
        },
        trigger: null,
      });
    } catch (err) {
      console.warn('[NotificationService] Failed to show update available notification:', err);
    }
  }

  /**
   * Clears the update notification from the system tray
   */
  public static async clearUpdateNotification(): Promise<void> {
    try {
      await Notifications.dismissNotificationAsync(UPDATE_NOTIFICATION_ID);
    } catch (err) {
      // Ignore
    }
  }
}
