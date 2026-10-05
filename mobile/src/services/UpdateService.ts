import { Platform, Linking } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
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

const SNOOZE_KEY_PREFIX = 'shiksha_update_snooze_';
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours
const RESUME_SNAP_KEY_PREFIX = 'shiksha_update_resume_snap_';

type ProgressCallback = (fraction: number, totalBytes: number) => void;

export class UpdateService {
  private static GITHUB_OWNER = 'abhay-bhagat-319';
  private static GITHUB_REPO = 'Project_S';
  private static RELEASES_API_URL = `https://api.github.com/repos/${UpdateService.GITHUB_OWNER}/${UpdateService.GITHUB_REPO}/releases/latest`;
  public static RELEASES_WEB_URL = `https://github.com/${UpdateService.GITHUB_OWNER}/${UpdateService.GITHUB_REPO}/releases/latest`;

  // Persistent in-memory tracking of active background download
  private static activeDownloadResumable: FileSystem.DownloadResumable | null = null;
  private static activeDownloadPromise: Promise<string> | null = null;
  private static activeDownloadVersion: string | null = null;
  private static progressListeners = new Set<ProgressCallback>();
  private static lastSnapSaveTime = 0;

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

      // If expectedSize is provided, ensure file is at least 90% of expected size (not incomplete)
      if (expectedSize && expectedSize > 0) {
        if (fileInfo.size < expectedSize * 0.9) {
          // File is incomplete / corrupt, remove it
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
          return false;
        }
      } else if (fileInfo.size < 5 * 1024 * 1024) {
        // Less than 5MB is definitely not a full release APK
        return false;
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

    const latestParts = cleanLatest.split('.').map(p => parseInt(p, 10) || 0);
    const currentParts = cleanCurrent.split('.').map(p => parseInt(p, 10) || 0);

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
          'Accept': 'application/vnd.github.v3+json',
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
      this.autoPruneStorage(currentVersion).catch(() => {});
      const isCached = hasUpdate ? await this.isApkCached(latestVersion, apkSizeBytes) : false;

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
   * Silently pre-fetches the latest update in the background and sends a local notification
   * when the file is verified and ready on disk for instant 1-tap installation.
   */
  public static async prefetchUpdateSilently(
    info: UpdateInfo,
    onProgress?: (fraction: number) => void
  ): Promise<boolean> {
    if (!info.hasUpdate || !info.apkDownloadUrl) return false;

    try {
      // Check if already cached
      const isCached = await this.isApkCached(info.latestVersion, info.apkSizeBytes);
      if (isCached) {
        await NotificationService.notifyUpdateReady(info.latestVersion, info.releaseName);
        return true;
      }

      // Download in background
      await this.downloadApk(
        info.apkDownloadUrl,
        info.latestVersion,
        info.apkSizeBytes,
        (fraction) => {
          if (onProgress) onProgress(fraction);
        }
      );

      // Verify and notify
      const verified = await this.isApkCached(info.latestVersion, info.apkSizeBytes);
      if (verified) {
        await NotificationService.notifyUpdateReady(info.latestVersion, info.releaseName);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[UpdateService] Silent prefetch failed:', e);
      // If silent prefetch failed, still notify about update availability
      await NotificationService.notifyUpdateAvailable(info.latestVersion, info.releaseName);
      return false;
    }
  }

  /**
   * Downloads APK to an atomic .tmp file, validates it, and renames it to the versioned filename.
   * If a download is already in progress, joins the active promise and streams progress.
   * Automatically saves resumable state to survive app minimization and background cycles.
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

    // If already actively downloading this version, attach and wait for existing execution
    if (this.activeDownloadPromise && this.activeDownloadVersion === cleanVer) {
      try {
        return await this.activeDownloadPromise;
      } finally {
        if (onProgress) this.progressListeners.delete(onProgress);
      }
    }

    // Check if already completely cached
    const finalPath = this.getApkPath(versionTag);
    const alreadyCached = await this.isApkCached(versionTag, expectedSize);
    if (alreadyCached) {
      if (onProgress) onProgress(1, expectedSize || 0);
      if (onProgress) this.progressListeners.delete(onProgress);
      return finalPath;
    }

    // Enforce single-APK retention before starting download
    await this.purgeOtherApks(versionTag);

    const updateDir = this.getUpdatesDirectory();
    const dirInfo = await FileSystem.getInfoAsync(updateDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(updateDir, { intermediates: true });
    }

    const tempPath = `${finalPath}.tmp`;

    // Start single shared execution
    this.activeDownloadVersion = cleanVer;

    const downloadExecutor = async (): Promise<string> => {
      try {
        const updateDir = this.getUpdatesDirectory();
        const dirInfo = await FileSystem.getInfoAsync(updateDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(updateDir, { intermediates: true });
        }

        const progressCallback = (downloadProgress: FileSystem.DownloadProgressData) => {
          const total = downloadProgress.totalBytesExpectedToWrite || expectedSize || 1;
          const progress = Math.min(1, Math.max(0, downloadProgress.totalBytesWritten / total));
          
          // Broadcast to all registered listeners
          this.progressListeners.forEach((fn) => {
            try { fn(progress, total); } catch {}
          });

          // Throttle-persist resume snapshot every 1.5 seconds so app can resume if killed
          const now = Date.now();
          if (this.activeDownloadResumable && now - this.lastSnapSaveTime > 1500) {
            this.lastSnapSaveTime = now;
            try {
              const snap = this.activeDownloadResumable.savable();
              AsyncStorage.setItem(snapKey, JSON.stringify(snap)).catch(() => {});
            } catch {}
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
          throw new Error('Downloaded APK package is corrupted or incomplete.');
        }

        // Atomically move .tmp to final .apk destination
        await FileSystem.deleteAsync(finalPath, { idempotent: true });
        await FileSystem.moveAsync({
          from: tempPath,
          to: finalPath,
        });

        // Clear resume snapshot on success
        await AsyncStorage.removeItem(snapKey);

        // Clean up any older cached APKs
        this.purgeOtherApks(versionTag).catch(() => {});

        // Broadcast 100% completion
        this.progressListeners.forEach((fn) => {
          try { fn(1, expectedSize || downloadedInfo.size || 0); } catch {}
        });

        return finalPath;
      } finally {
        this.activeDownloadResumable = null;
        this.activeDownloadPromise = null;
        this.activeDownloadVersion = null;
        if (onProgress) {
          this.progressListeners.delete(onProgress);
        }
      }
    };

    this.activeDownloadPromise = downloadExecutor();
    return this.activeDownloadPromise;
  }

  /**
   * Launches Android Package Installer using the cached APK
   */
  public static async installCachedApk(versionTag: string): Promise<void> {
    if (Platform.OS !== 'android') {
      await Linking.openURL(this.RELEASES_WEB_URL);
      return;
    }

    const finalPath = this.getApkPath(versionTag);
    const fileInfo = await FileSystem.getInfoAsync(finalPath);
    if (!fileInfo.exists) {
      throw new Error('Cached APK file not found. Please download the update again.');
    }

    const contentUri = await FileSystem.getContentUriAsync(finalPath);

    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });
  }

  /**
   * Downloads and installs in a single flow (used for foreground download)
   */
  public static async downloadAndInstall(
    apkUrl: string,
    versionTag: string,
    expectedSize?: number,
    onProgress?: (fraction: number, totalBytes: number) => void
  ): Promise<void> {
    await this.downloadApk(apkUrl, versionTag, expectedSize, onProgress);
    await this.installCachedApk(versionTag);
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
   * orphaned .tmp staging files, and ensures no obsolete release files remain.
   */
  public static async autoPruneStorage(currentVersionTag?: string): Promise<void> {
    try {
      const current = currentVersionTag || this.getCurrentVersion();
      const updateDir = this.getUpdatesDirectory();
      const dirInfo = await FileSystem.getInfoAsync(updateDir);
      if (!dirInfo.exists) return;

      const files = await FileSystem.readDirectoryAsync(updateDir);
      for (const file of files) {
        const filePath = `${updateDir}${file}`;
        
        // Remove .tmp files immediately
        if (file.endsWith('.tmp')) {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
          continue;
        }

        // Check version on APK files
        if (file.endsWith('.apk')) {
          const match = file.match(/Project_S-v([0-9.]+)\.apk/i);
          if (match && match[1]) {
            const fileVersion = match[1];
            // If the file version is older than or equal to current version, delete it
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
        if (file !== keepFileName) {
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
}

