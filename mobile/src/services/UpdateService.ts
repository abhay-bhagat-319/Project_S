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
  apkSha256?: string;
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

  private static activeDownloadResumable: FileSystem.DownloadResumable | null = null;
  private static activeDownloadPromise: Promise<string> | null = null;
  private static activeDownloadVersion: string | null = null;
  private static progressListeners = new Set<ProgressCallback>();
  private static lastSnapSaveTime = 0;

  /**
   * Validates that an APK download URL strictly uses HTTPS and points to the official GitHub repository
   * or GitHub's official release asset CDN.
   */
  public static isTrustedApkUrl(rawUrl: string | null | undefined): boolean {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:') return false;

      const host = parsed.hostname.toLowerCase();
      const expectedRepoPrefix = `/${this.GITHUB_OWNER.toLowerCase()}/${this.GITHUB_REPO.toLowerCase()}/releases/download/`;

      if (host === 'github.com' && parsed.pathname.toLowerCase().startsWith(expectedRepoPrefix)) {
        return true;
      }

      if (
        host === 'objects.githubusercontent.com' ||
        host === 'release-assets.githubusercontent.com'
      ) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

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
   * Extracts a 64-character hex SHA-256 digest from GitHub's asset.digest field ("sha256:...")
   * or from the release body if published there.
   */
  private static extractAssetSha256(asset: any, releaseBody?: string): string | undefined {
    if (asset && typeof asset.digest === 'string') {
      const match = asset.digest.match(/^sha256:([a-fA-F0-9]{64})$/);
      if (match) return match[1].toLowerCase();
    }
    if (releaseBody && asset && typeof asset.name === 'string') {
      const escapedName = asset.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bodyMatch = releaseBody.match(new RegExp(`([a-fA-F0-9]{64})\\s+\\*?${escapedName}`, 'i'));
      if (bodyMatch) return bodyMatch[1].toLowerCase();
    }
    return undefined;
  }

  /**
   * Selects the most optimal APK asset from a release payload.
   */
  public static selectBestApkAsset(assets: any[], releaseBody?: string): {
    url: string;
    size: number;
    name: string;
    sha256?: string;
    architecture: 'arm64-v8a' | 'universal' | 'standard';
  } | null {
    if (!Array.isArray(assets) || assets.length === 0) return null;

    const apkAssets = assets.filter(
      (a: any) =>
        typeof a.name === 'string' &&
        a.name.toLowerCase().endsWith('.apk') &&
        this.isTrustedApkUrl(a.browser_download_url)
    );

    if (apkAssets.length === 0) return null;

    const arm64Asset = apkAssets.find(
      (a: any) => /arm64[-_]?v8a/i.test(a.name) || /arm64/i.test(a.name)
    );
    if (arm64Asset) {
      return {
        url: arm64Asset.browser_download_url,
        size: arm64Asset.size || 0,
        name: arm64Asset.name,
        sha256: this.extractAssetSha256(arm64Asset, releaseBody),
        architecture: 'arm64-v8a',
      };
    }

    const universalAsset = apkAssets.find((a: any) => /universal/i.test(a.name));
    if (universalAsset) {
      return {
        url: universalAsset.browser_download_url,
        size: universalAsset.size || 0,
        name: universalAsset.name,
        sha256: this.extractAssetSha256(universalAsset, releaseBody),
        architecture: 'universal',
      };
    }

    const firstAsset = apkAssets[0];
    return {
      url: firstAsset.browser_download_url,
      size: firstAsset.size || 0,
      name: firstAsset.name,
      sha256: this.extractAssetSha256(firstAsset, releaseBody),
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
   * Returns a sanitized semantic version tag without leading 'v' or path traversal characters
   */
  public static cleanVersion(version: string): string {
    return version
      .replace(/^v/i, '')
      .replace(/[^0-9A-Za-z._-]/g, '')
      .trim();
  }

  /**
   * Returns the local file path for a versioned APK
   */
  public static getApkPath(versionTag: string): string {
    const clean = this.cleanVersion(versionTag);
    return `${this.getUpdatesDirectory()}Project_S-v${clean}.apk`;
  }

  /**
   * Verifies that a file on disk has the ZIP/APK magic header (PK\x03\x04 -> Base64 "UEsDB")
   */
  private static async hasValidApkMagicBytes(fileUri: string): Promise<boolean> {
    try {
      const headerB64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        length: 4,
        position: 0,
      });
      return headerB64.startsWith('UEsDB');
    } catch {
      return false;
    }
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

      // Require exact byte length match when expectedSize is provided by GitHub Releases API
      if (expectedSize && expectedSize > 0) {
        if (fileInfo.size !== expectedSize) {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
          return false;
        }
      } else if (fileInfo.size < 5 * 1024 * 1024) {
        return false;
      }

      const validMagic = await this.hasValidApkMagicBytes(fileUri);
      if (!validMagic) {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves the current app version dynamically
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

      let apkDownloadUrl: string | null = null;
      let apkSizeFormatted: string | undefined = undefined;
      let apkSizeBytes: number | undefined = undefined;
      let apkSha256: string | undefined = undefined;
      let apkArchitecture: 'arm64-v8a' | 'universal' | 'standard' = 'standard';
      let apkName: string | undefined = undefined;

      if (Array.isArray(releaseData.assets)) {
        const bestAsset = this.selectBestApkAsset(releaseData.assets, releaseData.body);

        if (bestAsset) {
          apkDownloadUrl = bestAsset.url;
          apkSizeBytes = bestAsset.size;
          apkSha256 = bestAsset.sha256;
          apkArchitecture = bestAsset.architecture;
          apkName = bestAsset.name;
          if (bestAsset.size) {
            const sizeInMb = (bestAsset.size / (1024 * 1024)).toFixed(1);
            apkSizeFormatted = `${sizeInMb} MB`;
          }
        }
      }

      const hasUpdate = this.isNewerVersion(latestVersion, currentVersion);
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
        apkSha256,
        apkArchitecture,
        apkName,
        isCached,
      };
    } catch (error) {
      if (__DEV__) {
        console.warn('[UpdateService] Update check failed:', error);
      }
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
   * when the file is verified and ready on disk.
   */
  public static async prefetchUpdateSilently(
    info: UpdateInfo,
    onProgress?: (fraction: number) => void
  ): Promise<boolean> {
    if (!info.hasUpdate || !info.apkDownloadUrl || !this.isTrustedApkUrl(info.apkDownloadUrl)) {
      return false;
    }

    try {
      const isCached = await this.isApkCached(info.latestVersion, info.apkSizeBytes);
      if (isCached) {
        await NotificationService.notifyUpdateReady(info.latestVersion, info.releaseName);
        return true;
      }

      await this.downloadApk(
        info.apkDownloadUrl,
        info.latestVersion,
        info.apkSizeBytes,
        (fraction) => {
          if (onProgress) onProgress(fraction);
        }
      );

      const verified = await this.isApkCached(info.latestVersion, info.apkSizeBytes);
      if (verified) {
        await NotificationService.notifyUpdateReady(info.latestVersion, info.releaseName);
        return true;
      }
      return false;
    } catch (e) {
      if (__DEV__) {
        console.warn('[UpdateService] Silent prefetch failed:', e);
      }
      await NotificationService.notifyUpdateAvailable(info.latestVersion, info.releaseName);
      return false;
    }
  }

  /**
   * Downloads APK to an atomic .tmp file, validates its origin, byte size, and APK header,
   * and renames it to the versioned filename.
   */
  public static async downloadApk(
    apkUrl: string,
    versionTag: string,
    expectedSize?: number,
    onProgress?: (fraction: number, totalBytes: number) => void
  ): Promise<string> {
    if (!this.isTrustedApkUrl(apkUrl)) {
      throw new Error('Untrusted APK download URL rejected.');
    }

    const cleanVer = this.cleanVersion(versionTag);
    const snapKey = `${RESUME_SNAP_KEY_PREFIX}${cleanVer}`;

    if (onProgress) {
      this.progressListeners.add(onProgress);
    }

    if (this.activeDownloadPromise && this.activeDownloadVersion === cleanVer) {
      try {
        return await this.activeDownloadPromise;
      } finally {
        if (onProgress) this.progressListeners.delete(onProgress);
      }
    }

    const finalPath = this.getApkPath(versionTag);
    const alreadyCached = await this.isApkCached(versionTag, expectedSize);
    if (alreadyCached) {
      if (onProgress) onProgress(1, expectedSize || 0);
      if (onProgress) this.progressListeners.delete(onProgress);
      return finalPath;
    }

    await this.purgeOtherApks(versionTag);

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

          this.progressListeners.forEach((fn) => {
            try {
              fn(progress, total);
            } catch {}
          });

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
        let useResume = false;
        try {
          savedSnapJson = await AsyncStorage.getItem(snapKey);
        } catch {}

        if (savedSnapJson) {
          try {
            const savedData = JSON.parse(savedSnapJson);
            // Strictly verify that the persisted snapshot URL and destination path have not been tampered with
            if (
              savedData &&
              savedData.url === apkUrl &&
              this.isTrustedApkUrl(savedData.url) &&
              savedData.fileUri === tempPath
            ) {
              resumable = new FileSystem.DownloadResumable(
                apkUrl,
                tempPath,
                {},
                progressCallback,
                savedData.resumeData
              );
              useResume = true;
            } else {
              await AsyncStorage.removeItem(snapKey);
              await FileSystem.deleteAsync(tempPath, { idempotent: true });
              resumable = FileSystem.createDownloadResumable(apkUrl, tempPath, {}, progressCallback);
            }
          } catch {
            await AsyncStorage.removeItem(snapKey);
            await FileSystem.deleteAsync(tempPath, { idempotent: true });
            resumable = FileSystem.createDownloadResumable(apkUrl, tempPath, {}, progressCallback);
          }
        } else {
          resumable = FileSystem.createDownloadResumable(apkUrl, tempPath, {}, progressCallback);
        }

        this.activeDownloadResumable = resumable;

        const downloadResult = useResume
          ? await resumable.resumeAsync()
          : await resumable.downloadAsync();

        if (!downloadResult || !downloadResult.uri) {
          throw new Error('Download stream interrupted.');
        }

        const downloadedInfo = await FileSystem.getInfoAsync(tempPath);
        if (!downloadedInfo.exists || !downloadedInfo.size || downloadedInfo.size < 1024 * 1024) {
          await FileSystem.deleteAsync(tempPath, { idempotent: true });
          throw new Error('Downloaded APK package is corrupted or incomplete.');
        }

        // Enforce exact size match when expectedSize is known
        if (expectedSize && expectedSize > 0 && downloadedInfo.size !== expectedSize) {
          await FileSystem.deleteAsync(tempPath, { idempotent: true });
          throw new Error('Downloaded APK size does not match release asset metadata.');
        }

        // Enforce valid ZIP/APK magic header
        const validMagic = await this.hasValidApkMagicBytes(tempPath);
        if (!validMagic) {
          await FileSystem.deleteAsync(tempPath, { idempotent: true });
          throw new Error('Downloaded file is not a valid Android package archive.');
        }

        await FileSystem.deleteAsync(finalPath, { idempotent: true });
        await FileSystem.moveAsync({
          from: tempPath,
          to: finalPath,
        });

        await AsyncStorage.removeItem(snapKey);
        this.purgeOtherApks(versionTag).catch(() => {});

        this.progressListeners.forEach((fn) => {
          try {
            fn(1, expectedSize || downloadedInfo.size || 0);
          } catch {}
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
   * Launches Android Package Installer using the verified cached APK
   */
  public static async installCachedApk(versionTag: string): Promise<void> {
    if (Platform.OS !== 'android') {
      await Linking.openURL(this.RELEASES_WEB_URL);
      return;
    }

    const finalPath = this.getApkPath(versionTag);
    const isValid = await this.isApkCached(versionTag);
    if (!isValid) {
      throw new Error('Cached APK file not found or failed integrity check. Please download the update again.');
    }

    const contentUri = await FileSystem.getContentUriAsync(finalPath);

    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });
  }

  /**
   * Downloads and installs in a single flow
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
   * Automatically prunes all APK files <= current running version and orphaned .tmp staging files
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

        if (file.endsWith('.tmp')) {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
          continue;
        }

        if (file.endsWith('.apk')) {
          const match = file.match(/Project_S-v([0-9.]+)\.apk/i);
          if (match && match[1]) {
            const fileVersion = match[1];
            if (!this.isNewerVersion(fileVersion, current)) {
              await FileSystem.deleteAsync(filePath, { idempotent: true });
            }
          }
        }
      }
    } catch (e) {
      if (__DEV__) {
        console.warn('[UpdateService] Auto prune storage warning:', e);
      }
    }
  }

  /**
   * Purges all APK files other than the specified target version
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
    } catch {
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
      if (__DEV__) {
        console.warn('[UpdateService] Failed to clear update files:', e);
      }
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
