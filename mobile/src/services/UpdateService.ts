import { Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  isCached?: boolean;
}

const SNOOZE_KEY_PREFIX = 'shiksha_update_snooze_';
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours

export class UpdateService {
  private static GITHUB_OWNER = 'abhay-bhagat-319';
  private static GITHUB_REPO = 'Project_S';
  private static RELEASES_API_URL = `https://api.github.com/repos/${UpdateService.GITHUB_OWNER}/${UpdateService.GITHUB_REPO}/releases/latest`;
  public static RELEASES_WEB_URL = `https://github.com/${UpdateService.GITHUB_OWNER}/${UpdateService.GITHUB_REPO}/releases/latest`;

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
   * Retrieves the current app version from app.json / native binary
   */
  public static getCurrentVersion(): string {
    return (
      Constants.expoConfig?.version ||
      Application.nativeApplicationVersion ||
      '1.0.0'
    );
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

      // Locate APK asset if available
      let apkDownloadUrl: string | null = null;
      let apkSizeFormatted: string | undefined = undefined;
      let apkSizeBytes: number | undefined = undefined;

      if (Array.isArray(releaseData.assets)) {
        const apkAsset = releaseData.assets.find((asset: any) => 
          asset.name && asset.name.toLowerCase().endsWith('.apk')
        );

        if (apkAsset) {
          apkDownloadUrl = apkAsset.browser_download_url;
          apkSizeBytes = apkAsset.size;
          if (apkAsset.size) {
            const sizeInMb = (apkAsset.size / (1024 * 1024)).toFixed(1);
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
   * Downloads APK to an atomic .tmp file, validates it, and renames it to the versioned filename
   */
  public static async downloadApk(
    apkUrl: string,
    versionTag: string,
    expectedSize?: number,
    onProgress?: (fraction: number, totalBytes: number) => void
  ): Promise<string> {
    // Enforce single-APK retention before downloading new release
    await this.purgeOtherApks(versionTag);

    const updateDir = this.getUpdatesDirectory();
    const dirInfo = await FileSystem.getInfoAsync(updateDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(updateDir, { intermediates: true });
    }

    const finalPath = this.getApkPath(versionTag);
    const tempPath = `${finalPath}.tmp`;

    // Check if already completely cached
    const alreadyCached = await this.isApkCached(versionTag, expectedSize);
    if (alreadyCached) {
      if (onProgress) onProgress(1, expectedSize || 0);
      return finalPath;
    }

    // Clean any previous interrupted temp file
    await FileSystem.deleteAsync(tempPath, { idempotent: true });

    const downloadResumable = FileSystem.createDownloadResumable(
      apkUrl,
      tempPath,
      {},
      (downloadProgress) => {
        const total = downloadProgress.totalBytesExpectedToWrite || expectedSize || 1;
        const progress = downloadProgress.totalBytesWritten / total;
        if (onProgress) {
          onProgress(Math.min(1, Math.max(0, progress)), total);
        }
      }
    );

    const downloadResult = await downloadResumable.downloadAsync();
    if (!downloadResult || !downloadResult.uri) {
      throw new Error('Download failed to produce a valid file output.');
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

    // Clean up older cached APKs to free storage
    this.purgeOtherApks(versionTag).catch(() => {});

    return finalPath;
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

