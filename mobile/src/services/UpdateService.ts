import { Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

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
}

export class UpdateService {
  private static GITHUB_OWNER = 'abhay-bhagat-319';
  private static GITHUB_REPO = 'Project_S';
  private static RELEASES_API_URL = `https://api.github.com/repos/${UpdateService.GITHUB_OWNER}/${UpdateService.GITHUB_REPO}/releases/latest`;
  public static RELEASES_WEB_URL = `https://github.com/${UpdateService.GITHUB_OWNER}/${UpdateService.GITHUB_REPO}/releases/latest`;

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
    const cleanLatest = latestVersion.replace(/^v/i, '').trim();
    const cleanCurrent = currentVersion.replace(/^v/i, '').trim();

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
   * Checks GitHub Releases API for new published version
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
      const latestVersion = tagName.replace(/^v/i, '') || currentVersion;

      // Locate APK asset if available
      let apkDownloadUrl: string | null = null;
      let apkSizeFormatted: string | undefined = undefined;

      if (Array.isArray(releaseData.assets)) {
        const apkAsset = releaseData.assets.find((asset: any) => 
          asset.name && asset.name.toLowerCase().endsWith('.apk')
        );

        if (apkAsset) {
          apkDownloadUrl = apkAsset.browser_download_url;
          if (apkAsset.size) {
            const sizeInMb = (apkAsset.size / (1024 * 1024)).toFixed(1);
            apkSizeFormatted = `${sizeInMb} MB`;
          }
        }
      }

      const hasUpdate = this.isNewerVersion(latestVersion, currentVersion);

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
   * Downloads APK from GitHub Releases and triggers Android package installer
   */
  public static async downloadAndInstall(
    apkUrl: string,
    versionTag: string,
    onProgress?: (fraction: number, totalBytes: number) => void
  ): Promise<void> {
    if (Platform.OS !== 'android') {
      // Fallback for non-Android platforms
      await Linking.openURL(this.RELEASES_WEB_URL);
      return;
    }

    try {
      const updateDir = `${FileSystem.cacheDirectory}updates/`;
      const dirInfo = await FileSystem.getInfoAsync(updateDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(updateDir, { intermediates: true });
      }

      const fileUri = `${updateDir}Project_S_v${versionTag}.apk`;

      const downloadResumable = FileSystem.createDownloadResumable(
        apkUrl,
        fileUri,
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          if (onProgress) {
            onProgress(Math.min(1, Math.max(0, progress)), downloadProgress.totalBytesExpectedToWrite);
          }
        }
      );

      const downloadResult = await downloadResumable.downloadAsync();
      if (!downloadResult || !downloadResult.uri) {
        throw new Error('Download failed to produce a valid file output.');
      }

      // Convert to Android Content URI
      const contentUri = await FileSystem.getContentUriAsync(downloadResult.uri);

      // Fire Android Package Installer View Intent
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/vnd.android.package-archive',
      });
    } catch (error) {
      console.error('[UpdateService] Failed to download or install update:', error);
      throw error;
    }
  }
}
