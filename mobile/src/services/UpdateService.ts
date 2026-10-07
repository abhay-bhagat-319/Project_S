import { Platform, Linking, AppState } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { NotificationService } from './NotificationService';

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  apkDownloadUrl: string | null;
  htmlUrl: string;
  apkSizeFormatted?: string;
  apkSizeBytes?: number;
  apkArchitecture?: 'arm64-v8a' | 'universal' | 'standard';
  apkName?: string;
  isCached?: boolean;
}

export interface PendingDownloadMeta {
  version: string;
  url: string;
  expectedSize?: number;
  releaseName?: string;
  startedAt: number;
}

const SNOOZE_KEY_PREFIX = 'shiksha_update_snooze_';
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours
const RESUME_SNAP_KEY_PREFIX = 'shiksha_update_resume_snap_';
const PENDING_DOWNLOAD_META_KEY = 'shiksha_update_pending_meta';

type ProgressCallback = (fraction: number, totalBytes: number) => void;

export const BACKGROUND_UPDATE_TASK = 'PROJECT_S_BACKGROUND_UPDATE_TASK';

// Define the headless background update task at module load time for Android WorkManager
try {
  TaskManager.defineTask(BACKGROUND_UPDATE_TASK, async () => {
    try {
      console.log('[BackgroundTask] Executing periodic background update check...');
      const info = await UpdateService.checkForUpdate();
      if (info.hasUpdate && info.apkDownloadUrl && !info.isCached) {
        console.log(`[BackgroundTask] New release detected: v${info.latestVersion}. Starting silent background prefetch...`);
        await UpdateService.downloadApk(info.apkDownloadUrl, info.latestVersion, info.apkSizeBytes);
        return BackgroundFetch.BackgroundFetchResult.NewData;
      }
      return BackgroundFetch.BackgroundFetchResult.NoData;
    } catch (error) {
      console.warn('[BackgroundTask] Background update check failed:', error);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
} catch (e) {
  // Safe fallback for environments where TaskManager isn't available
}

export class UpdateService {
  private static GITHUB_OWNER = 'abhay-bhagat-319';
  private static GITHUB_REPO = 'Project_S';
  private static RELEASES_API_URL = `https://api.github.com/repos/${UpdateService.GITHUB_OWNER}/${UpdateService.GITHUB_REPO}/releases/latest`;
  public static RELEASES_WEB_URL = `https://github.com/${UpdateService.GITHUB_OWNER}/${UpdateService.GITHUB_REPO}/releases/latest`;

  // In-memory tracking of active background download
  private static activeDownloadResumable: FileSystem.DownloadResumable | null = null;
  private static activeDownloadPromise: Promise<string> | null = null;
  private static activeDownloadVersion: string | null = null;
  private static progressListeners = new Set<ProgressCallback>();
  private static lastSnapSaveTime = 0;
  private static isResuming = false;

  /**
   * Registers a listener for live background download progress
   */
  public static addProgressListener(listener: ProgressCallback): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  /**
   * Broadcasts progress event to all active listeners
   */
  private static broadcastProgress(fraction: number, totalBytes: number): void {
    this.progressListeners.forEach((fn) => {
      try {
        fn(fraction, totalBytes);
      } catch (err) {
        console.warn('[UpdateService] Listener error:', err);
      }
    });
  }

  /**
   * Checks if a download is currently active in the background
   */
  public static isDownloading(versionTag?: string): boolean {
    if (!this.activeDownloadResumable || !this.activeDownloadPromise) return false;
    if (!versionTag) return true;
    return this.cleanVersion(versionTag) === this.cleanVersion(this.activeDownloadVersion || '');
  }

  /**
   * Returns current active download version if any
   */
  public static getActiveDownloadVersion(): string | null {
    return this.activeDownloadVersion;
  }

  /**
   * Selects the most optimal APK asset from a release payload.
   * Prioritizes targeted arm64-v8a APK (~20MB) for modern Android devices,
   * falling back to universal (~70MB) or any generic APK asset.
   */
  public static selectBestApkAsset(assets: any[]): {
    url: string;
    size: number;
    name: string;
    architecture: 'arm64-v8a' | 'universal' | 'standard';
  } | null {
    if (!Array.isArray(assets) || assets.length === 0) return null;

    const apkAssets = assets.filter((a: any) =>
      typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk')
    );

    if (apkAssets.length === 0) return null;

    // 1. Try to find arm64-v8a targeted APK (99.8% of modern student phones)
    const arm64Asset = apkAssets.find((a: any) =>
      /arm64[-_]?v8a/i.test(a.name) || /arm64/i.test(a.name)
    );
    if (arm64Asset) {
      return {
        url: arm64Asset.browser_download_url,
        size: arm64Asset.size || 0,
        name: arm64Asset.name,
        architecture: 'arm64-v8a',
      };
    }

    // 2. Fallback to universal APK
    const universalAsset = apkAssets.find((a: any) =>
      /universal/i.test(a.name)
    );
    if (universalAsset) {
      return {
        url: universalAsset.browser_download_url,
        size: universalAsset.size || 0,
        name: universalAsset.name,
        architecture: 'universal',
      };
    }

    // 3. Fallback to first available APK
    const firstAsset = apkAssets[0];
    return {
      url: firstAsset.browser_download_url,
      size: firstAsset.size || 0,
      name: firstAsset.name,
      architecture: 'standard',
    };
  }

  /**
   * Retrieves the persistent directory used to store downloaded APKs
   */
  public static getUpdatesDirectory(): string {
    return `${FileSystem.documentDirectory || FileSystem.cacheDirectory}updates/`;
  }

  /**
   * Returns the clean version tag without leading 'v'
   */
  public static cleanVersion(version: string): string {
    return version.replace(/^v/i, '').trim();
  }

  /**
   * Returns the local file path for a versioned APK
   */
  public static getApkPath(versionTag: string): string {
    const clean = this.cleanVersion(versionTag);
    return `${this.getUpdatesDirectory()}Project_S-v${clean}.apk`;
  }

  /**
   * Checks whether a complete and valid APK file already exists for the given version
   */
  public static async isApkCached(versionTag: string, expectedSize?: number): Promise<boolean> {
    try {
      const fileUri = this.getApkPath(versionTag);
      const fileInfo = await FileSystem.getInfoAsync(fileUri);

      if (!fileInfo.exists || fileInfo.isDirectory || !fileInfo.size) {
        return false;
      }

      // If file is less than 1MB, it cannot be a real APK
      if (fileInfo.size < 1024 * 1024) {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
        return false;
      }

      // If expectedSize is provided and greater than 0, ensure it's not a severe truncation
      if (expectedSize && expectedSize > 0) {
        if (fileInfo.size < expectedSize * 0.85) {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves the current app version dynamically:
   * - In Expo Go: reads project manifest version from app.json (Constants.expoConfig.version)
   * - In Native Standalone APK: reads OS Package Manager version (Application.nativeApplicationVersion)
   */
  public static getCurrentVersion(): string {
    const isExpoGo =
      Constants.appOwnership === 'expo' ||
      Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

    if (isExpoGo) {
      return Constants.expoConfig?.version || '1.0.0';
    }

    if (Application.nativeApplicationVersion) {
      return Application.nativeApplicationVersion;
    }

    return Constants.expoConfig?.version || '1.0.0';
  }

  /**
   * Compares two semantic version strings (e.g. "1.0.1" > "1.0.0")
   */
  public static isNewerVersion(latestVersion: string, currentVersion: string): boolean {
    const cleanLatest = this.cleanVersion(latestVersion);
    const cleanCurrent = this.cleanVersion(currentVersion);

    if (!cleanLatest || !cleanCurrent) return false;
    if (cleanLatest === cleanCurrent) return false;

    const latestParts = cleanLatest.split('.').map((p) => parseInt(p, 10) || 0);
    const currentParts = cleanCurrent.split('.').map((p) => parseInt(p, 10) || 0);

    const maxLength = Math.max(latestParts.length, currentParts.length);

    for (let i = 0; i < maxLength; i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }

    return false;
  }

  /**
   * Checks GitHub Releases API for new published version and detects if APK is cached
   */
  public static async checkForUpdate(): Promise<UpdateInfo> {
    const currentVersion = this.getCurrentVersion();

    try {
      const response = await fetch(this.RELEASES_API_URL, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Project_S-App',
        },
      });

      if (!response.ok) {
        return {
          hasUpdate: false,
          currentVersion,
          latestVersion: currentVersion,
          releaseName: '',
          releaseNotes: '',
          publishedAt: '',
          apkDownloadUrl: null,
          htmlUrl: this.RELEASES_WEB_URL,
        };
      }

      const releaseData = await response.json();
      const tagName = releaseData.tag_name || '';
      const latestVersion = this.cleanVersion(tagName) || currentVersion;

      // Locate and select the best APK asset (arm64-v8a preferred, universal fallback)
      let apkDownloadUrl: string | null = null;
      let apkSizeFormatted: string | undefined = undefined;
      let apkSizeBytes: number | undefined = undefined;
      let apkArchitecture: 'arm64-v8a' | 'universal' | 'standard' = 'standard';
      let apkName: string | undefined = undefined;

      if (Array.isArray(releaseData.assets)) {
        const bestAsset = this.selectBestApkAsset(releaseData.assets);

        if (bestAsset) {
          apkDownloadUrl = bestAsset.url;
          apkSizeBytes = bestAsset.size;
          apkArchitecture = bestAsset.architecture;
          apkName = bestAsset.name;
          if (bestAsset.size) {
            const sizeInMb = (bestAsset.size / (1024 * 1024)).toFixed(1);
            apkSizeFormatted = `${sizeInMb} MB`;
          }
        }
      }

      const hasUpdate = this.isNewerVersion(latestVersion, currentVersion);

      // Automatically prune older/orphaned APKs and temp files
      await this.autoPruneStorage(currentVersion).catch(() => {});

      const isCached = hasUpdate ? await this.isApkCached(latestVersion, apkSizeBytes) : false;

      // If we don't have an update, clear any stale pending download metadata
      if (!hasUpdate) {
        await AsyncStorage.removeItem(PENDING_DOWNLOAD_META_KEY).catch(() => {});
        await NotificationService.clearUpdateNotification().catch(() => {});
      }

      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseName: releaseData.name || tagName,
        releaseNotes: releaseData.body || 'New stability improvements and fixes.',
        publishedAt: releaseData.published_at || '',
        apkDownloadUrl,
        htmlUrl: releaseData.html_url || this.RELEASES_WEB_URL,
        apkSizeFormatted,
        apkSizeBytes,
        apkArchitecture,
        apkName,
        isCached,
      };
    } catch (error) {
      console.warn('[UpdateService] Update check failed:', error);
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        releaseName: '',
        releaseNotes: '',
        publishedAt: '',
        apkDownloadUrl: null,
        htmlUrl: this.RELEASES_WEB_URL,
      };
    }
  }

  /**
   * Persistently saves pending download metadata so download can be resumed across restarts
   */
  public static async savePendingDownloadMeta(meta: PendingDownloadMeta): Promise<void> {
    try {
      await AsyncStorage.setItem(PENDING_DOWNLOAD_META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.warn('[UpdateService] Failed to save pending download meta:', e);
    }
  }

  /**
   * Retrieves pending download metadata if an incomplete download exists
   */
  public static async getPendingDownloadMeta(): Promise<PendingDownloadMeta | null> {
    try {
      const data = await AsyncStorage.getItem(PENDING_DOWNLOAD_META_KEY);
      if (!data) return null;
      return JSON.parse(data) as PendingDownloadMeta;
    } catch {
      return null;
    }
  }

  /**
   * Clears pending download metadata on completion or cancellation
   */
  public static async clearPendingDownloadMeta(): Promise<void> {
    try {
      await AsyncStorage.removeItem(PENDING_DOWNLOAD_META_KEY);
    } catch {}
  }

  /**
   * Automatic background download resumption hook.
   * Invoked on app boot, AppState active transition, and network recovery.
   * Automatically picks up any incomplete download and continues streaming seamlessly.
   */
  public static async resumePendingDownloadIfAny(): Promise<string | null> {
    if (this.isResuming || this.isDownloading()) {
      return null;
    }

    try {
      this.isResuming = true;
      const pendingMeta = await this.getPendingDownloadMeta();
      if (!pendingMeta || !pendingMeta.url || !pendingMeta.version) {
        return null;
      }

      const currentVersion = this.getCurrentVersion();
      if (!this.isNewerVersion(pendingMeta.version, currentVersion)) {
        // App already upgraded or version is obsolete, clear meta
        await this.clearPendingDownloadMeta();
        return null;
      }

      // Check if already cached
      const isCached = await this.isApkCached(pendingMeta.version, pendingMeta.expectedSize);
      if (isCached) {
        await this.clearPendingDownloadMeta();
        this.broadcastProgress(1, pendingMeta.expectedSize || 1);
        return this.getApkPath(pendingMeta.version);
      }

      console.log(`[UpdateService] Resuming pending background download for v${pendingMeta.version}...`);

      // Resume download in background
      return await this.downloadApk(
        pendingMeta.url,
        pendingMeta.version,
        pendingMeta.expectedSize
      );
    } catch (err) {
      console.warn('[UpdateService] Pending download resume error (will retry on next event):', err);
      return null;
    } finally {
      this.isResuming = false;
    }
  }

  /**
   * Downloads APK to an atomic .tmp file, validates it, and renames it to the versioned filename.
   * If a download is already in progress, joins the active promise and streams progress.
   * Automatically saves resumable state to survive app minimization, network cuts, and restarts.
   */
  public static async downloadApk(
    apkUrl: string,
    versionTag: string,
    expectedSize?: number,
    onProgress?: (fraction: number, totalBytes: number) => void
  ): Promise<string> {
    const cleanVer = this.cleanVersion(versionTag);
    const snapKey = `${RESUME_SNAP_KEY_PREFIX}${cleanVer}`;

    if (onProgress) {
      this.progressListeners.add(onProgress);
    }

    // If already actively downloading this version, attach to existing promise
    if (this.activeDownloadPromise && this.activeDownloadVersion === cleanVer) {
      try {
        return await this.activeDownloadPromise;
      } finally {
        if (onProgress) this.progressListeners.delete(onProgress);
      }
    }

    // Check if already completely cached on disk
    const finalPath = this.getApkPath(versionTag);
    const alreadyCached = await this.isApkCached(versionTag, expectedSize);
    if (alreadyCached) {
      this.broadcastProgress(1, expectedSize || 1);
      if (onProgress) this.progressListeners.delete(onProgress);
      await this.clearPendingDownloadMeta();
      return finalPath;
    }

    // Save pending download metadata for cold-boot auto-recovery
    await this.savePendingDownloadMeta({
      version: cleanVer,
      url: apkUrl,
      expectedSize,
      startedAt: Date.now(),
    });

    const updateDir = this.getUpdatesDirectory();
    const dirInfo = await FileSystem.getInfoAsync(updateDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(updateDir, { intermediates: true });
    }

    const tempPath = `${finalPath}.tmp`;
    this.activeDownloadVersion = cleanVer;

    const downloadExecutor = async (): Promise<string> => {
      try {
        const progressCallback = (downloadProgress: FileSystem.DownloadProgressData) => {
          const total = downloadProgress.totalBytesExpectedToWrite || expectedSize || 1;
          const progress = Math.min(1, Math.max(0, downloadProgress.totalBytesWritten / total));

          // Broadcast to all registered UI listeners
          this.broadcastProgress(progress, total);

          // Throttle-persist resume snapshot and update ongoing notification when minimized
          const now = Date.now();
          if (this.activeDownloadResumable && now - this.lastSnapSaveTime > 1500) {
            this.lastSnapSaveTime = now;
            try {
              const snap = this.activeDownloadResumable.savable();
              AsyncStorage.setItem(snapKey, JSON.stringify(snap)).catch(() => {});
            } catch {}

            // If app is currently in background, update ongoing notification to keep process/socket active
            if (AppState.currentState !== 'active') {
              NotificationService.updateDownloadProgressNotification(cleanVer, progress).catch(() => {});
            }
          }
        };

        let resumable: FileSystem.DownloadResumable;
        let savedSnapJson: string | null = null;
        try {
          savedSnapJson = await AsyncStorage.getItem(snapKey);
        } catch {}

        if (savedSnapJson) {
          try {
            const savedData = JSON.parse(savedSnapJson);
            resumable = new FileSystem.DownloadResumable(
              savedData.url || apkUrl,
              savedData.fileUri || tempPath,
              savedData.options || {},
              progressCallback,
              savedData.resumeData
            );
          } catch {
            await AsyncStorage.removeItem(snapKey);
            await FileSystem.deleteAsync(tempPath, { idempotent: true });
            resumable = FileSystem.createDownloadResumable(apkUrl, tempPath, {}, progressCallback);
          }
        } else {
          resumable = FileSystem.createDownloadResumable(apkUrl, tempPath, {}, progressCallback);
        }

        this.activeDownloadResumable = resumable;

        let downloadResult: FileSystem.FileSystemDownloadResult | undefined;
        if (savedSnapJson) {
          downloadResult = await resumable.resumeAsync();
        } else {
          downloadResult = await resumable.downloadAsync();
        }

        if (!downloadResult || !downloadResult.uri) {
          throw new Error('Download stream interrupted.');
        }

        // Validate downloaded file
        const downloadedInfo = await FileSystem.getInfoAsync(tempPath);
        if (!downloadedInfo.exists || !downloadedInfo.size || downloadedInfo.size < 1024 * 1024) {
          await FileSystem.deleteAsync(tempPath, { idempotent: true });
          throw new Error('Downloaded update package is corrupted or incomplete.');
        }

        // Atomically move .tmp to final .apk destination
        await FileSystem.deleteAsync(finalPath, { idempotent: true });
        await FileSystem.moveAsync({
          from: tempPath,
          to: finalPath,
        });

        // Clear resume snapshot & pending metadata on success
        await AsyncStorage.removeItem(snapKey);
        await this.clearPendingDownloadMeta();

        // Enforce single-APK retention (clean older versions)
        this.purgeOtherApks(versionTag).catch(() => {});

        // Broadcast 100% completion
        this.broadcastProgress(1, expectedSize || downloadedInfo.size || 0);

        // Smart Notification:
        // If app is currently in background/closed, dispatch high-priority notification.
        // If app is actively in foreground, App.tsx handles re-opening the install modal directly.
        if (AppState.currentState !== 'active') {
          await NotificationService.notifyUpdateReady(versionTag);
        }

        return finalPath;
      } catch (err: any) {
        // If an error occurred (e.g. network cutoff), persist snapshot state if possible
        if (this.activeDownloadResumable) {
          try {
            const snap = this.activeDownloadResumable.savable();
            await AsyncStorage.setItem(snapKey, JSON.stringify(snap));
          } catch {}
        }
        throw err;
      } finally {
        this.activeDownloadResumable = null;
        this.activeDownloadPromise = null;
        this.activeDownloadVersion = null;
        if (onProgress) {
          this.progressListeners.delete(onProgress);
        }
        await NotificationService.clearDownloadProgressNotification().catch(() => {});
      }
    };

    this.activeDownloadPromise = downloadExecutor();
    return this.activeDownloadPromise;
  }

  /**
   * Launches Android Package Installer using the cached APK.
   * Does NOT delete the APK on launch so if the user cancels inside the installer,
   * the cached APK is preserved for 1-tap re-installation.
   */
  public static async installCachedApk(versionTag: string): Promise<void> {
    if (Platform.OS !== 'android') {
      await Linking.openURL(this.RELEASES_WEB_URL);
      return;
    }

    const currentVersion = this.getCurrentVersion();
    // If the app is already at or above this version, no need to install
    if (!this.isNewerVersion(versionTag, currentVersion)) {
      await this.autoPruneStorage(currentVersion).catch(() => {});
      return;
    }

    const finalPath = this.getApkPath(versionTag);
    const fileInfo = await FileSystem.getInfoAsync(finalPath);
    if (!fileInfo.exists) {
      throw new Error('Cached update file not found. Please download the update again.');
    }

    const contentUri = await FileSystem.getContentUriAsync(finalPath);

    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });
  }

  /**
   * Records a 24-hour snooze for a specific release version
   */
  public static async snoozeUpdate(versionTag: string): Promise<void> {
    const clean = this.cleanVersion(versionTag);
    await AsyncStorage.setItem(`${SNOOZE_KEY_PREFIX}${clean}`, Date.now().toString());
  }

  /**
   * Checks if an update version has been snoozed within the last 24 hours
   */
  public static async isUpdateSnoozed(versionTag: string): Promise<boolean> {
    try {
      const clean = this.cleanVersion(versionTag);
      const val = await AsyncStorage.getItem(`${SNOOZE_KEY_PREFIX}${clean}`);
      if (!val) return false;
      const timestamp = parseInt(val, 10);
      if (isNaN(timestamp)) return false;
      return Date.now() - timestamp < SNOOZE_DURATION_MS;
    } catch {
      return false;
    }
  }

  /**
   * Automatically prunes all APK files <= current running version,
   * orphaned .tmp staging files (if not actively downloading),
   * and ensures storage remains clean after updates.
   */
  public static async autoPruneStorage(currentVersionTag?: string): Promise<void> {
    try {
      const current = currentVersionTag || this.getCurrentVersion();
      const updateDir = this.getUpdatesDirectory();
      const dirInfo = await FileSystem.getInfoAsync(updateDir);
      if (!dirInfo.exists) return;

      const files = await FileSystem.readDirectoryAsync(updateDir);
      const isCurrentlyDownloading = this.isDownloading();
      const activeVersion = this.activeDownloadVersion;

      for (const file of files) {
        const filePath = `${updateDir}${file}`;

        // Clean .tmp files only if no active download is currently writing to them
        if (file.endsWith('.tmp')) {
          if (!isCurrentlyDownloading) {
            await FileSystem.deleteAsync(filePath, { idempotent: true });
          }
          continue;
        }

        // Check version on APK files
        if (file.endsWith('.apk')) {
          const match = file.match(/Project_S-v([0-9.]+)\.apk/i);
          if (match && match[1]) {
            const fileVersion = match[1];
            // If the file version is older than or equal to current version, delete it immediately
            if (!this.isNewerVersion(fileVersion, current)) {
              await FileSystem.deleteAsync(filePath, { idempotent: true });
            }
          }
        }
      }
    } catch (e) {
      console.warn('[UpdateService] Auto prune storage warning:', e);
    }
  }

  /**
   * Purges all APK files other than the specified target version (enforces single-APK retention)
   */
  public static async purgeOtherApks(keepVersionTag: string): Promise<void> {
    try {
      const updateDir = this.getUpdatesDirectory();
      const dirInfo = await FileSystem.getInfoAsync(updateDir);
      if (!dirInfo.exists) return;

      const files = await FileSystem.readDirectoryAsync(updateDir);
      const keepFileName = `Project_S-v${this.cleanVersion(keepVersionTag)}.apk`;

      for (const file of files) {
        if (file !== keepFileName && file.endsWith('.apk')) {
          await FileSystem.deleteAsync(`${updateDir}${file}`, { idempotent: true });
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Cleans all update files and APKs in storage
   */
  public static async clearAllUpdateFiles(): Promise<void> {
    try {
      const updateDir = this.getUpdatesDirectory();
      const dirInfo = await FileSystem.getInfoAsync(updateDir);
      if (dirInfo.exists) {
        await FileSystem.deleteAsync(updateDir, { idempotent: true });
      }
      await this.clearPendingDownloadMeta();
    } catch (e) {
      console.warn('[UpdateService] Failed to clear update files:', e);
    }
  }

  /**
   * Computes the total byte size of all update files currently cached on disk
   */
  public static async getTotalUpdateStorageBytes(): Promise<number> {
    try {
      const updateDir = this.getUpdatesDirectory();
      const dirInfo = await FileSystem.getInfoAsync(updateDir);
      if (!dirInfo.exists) return 0;

      const files = await FileSystem.readDirectoryAsync(updateDir);
      let total = 0;
      for (const file of files) {
        const fileInfo = await FileSystem.getInfoAsync(`${updateDir}${file}`);
        if (fileInfo.exists && !fileInfo.isDirectory && fileInfo.size) {
          total += fileInfo.size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  /**
   * Registers the periodic background fetch task with Android WorkManager.
   * Runs every 6 hours silently even when the app is closed.
   */
  public static async registerBackgroundUpdateTask(): Promise<void> {
    const isExpoGo =
      Constants.appOwnership === 'expo' ||
      Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    if (isExpoGo) return;

    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_UPDATE_TASK);
      if (!isRegistered) {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_UPDATE_TASK, {
          minimumInterval: 6 * 60 * 60, // 6 hours
          stopOnTerminate: false,
          startOnBoot: true,
        });
        console.log('[UpdateService] Background update task registered with WorkManager.');
      }
    } catch (err) {
      console.warn('[UpdateService] Failed to register background update task:', err);
    }
  }
}
