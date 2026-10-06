import { Platform, AppState } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const UPDATE_NOTIFICATION_CHANNEL_ID = 'app-updates';
const UPDATE_NOTIFICATION_ID = 'project-s-app-update';

let _notificationsModule: typeof import('expo-notifications') | null = null;
function getNotifications(): typeof import('expo-notifications') | null {
  if (!_notificationsModule) {
    try {
      _notificationsModule = require('expo-notifications');
    } catch {
      _notificationsModule = null;
    }
  }
  return _notificationsModule;
}

export class NotificationService {
  private static isInitialized = false;

  /**
   * Returns true if notifications are fully supported on this runtime environment.
   * In Expo Go (SDK 53+), native notification features are restricted.
   */
  public static isSupported(): boolean {
    const isExpoGo =
      Constants.appOwnership === 'expo' ||
      Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    return !isExpoGo;
  }

  /**
   * Initializes notification channels, handlers, and permissions for Android standalone builds.
   * Safe no-op in Expo Go to prevent runtime crashes.
   */
  public static async init(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    const Notifications = getNotifications();
    if (!Notifications) return false;

    if (this.isInitialized) return true;

    try {
      // Lazy configure foreground handler only on supported native runtimes
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

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
   * Registers a listener for user interaction with notifications (tap/action).
   * Returns an unsubscribe function.
   */
  public static registerResponseListener(
    onAction: (action: 'INSTALL_UPDATE' | 'OPEN_UPDATE_MODAL', version?: string) => void
  ): () => void {
    if (!this.isSupported()) {
      return () => {};
    }

    const Notifications = getNotifications();
    if (!Notifications) return () => {};

    try {
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as Record<string, any> | undefined;
        const action = data?.action;
        const version = data?.version ? String(data.version) : undefined;

        if (action === 'INSTALL_UPDATE' || action === 'OPEN_UPDATE_MODAL') {
          onAction(action, version);
        }
      });

      return () => {
        subscription.remove();
      };
    } catch {
      return () => {};
    }
  }

  /**
   * Checks if the app was launched directly by tapping a notification.
   */
  public static async checkColdLaunchResponse(
    onAction: (action: 'INSTALL_UPDATE' | 'OPEN_UPDATE_MODAL', version?: string) => void
  ): Promise<void> {
    if (!this.isSupported()) return;

    const Notifications = getNotifications();
    if (!Notifications) return;

    try {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (response) {
        const data = response.notification.request.content.data as Record<string, any> | undefined;
        const action = data?.action;
        const version = data?.version ? String(data.version) : undefined;

        if (action === 'INSTALL_UPDATE' || action === 'OPEN_UPDATE_MODAL') {
          onAction(action, version);
        }
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Sends a local notification when an update has been downloaded and is ready to install.
   * Only sends if the app is currently in background or closed (AppState !== 'active')
   * to avoid bothering the student while actively using the app.
   */
  public static async notifyUpdateReady(version: string, releaseName?: string): Promise<void> {
    if (!this.isSupported()) return;

    // Suppress system push notification if the user has the app open in foreground
    if (AppState.currentState === 'active') {
      return;
    }

    const Notifications = getNotifications();
    if (!Notifications) return;

    try {
      await this.init();
      const title = 'Update Ready to Install 🚀';
      const body =
        releaseName && releaseName !== `v${version}` && releaseName !== version
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
   * Sends a local notification when an update is available.
   * Only sends if the app is in background or closed.
   */
  public static async notifyUpdateAvailable(version: string, releaseName?: string): Promise<void> {
    if (!this.isSupported()) return;

    if (AppState.currentState === 'active') {
      return;
    }

    const Notifications = getNotifications();
    if (!Notifications) return;

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
    if (!this.isSupported()) return;

    const Notifications = getNotifications();
    if (!Notifications) return;

    try {
      await Notifications.dismissNotificationAsync(UPDATE_NOTIFICATION_ID);
    } catch (err) {
      // Ignore
    }
  }
}
