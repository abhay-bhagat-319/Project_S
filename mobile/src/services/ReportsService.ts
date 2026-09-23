import { Platform, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { CacheService, ReportItem } from './CacheService';

export class ReportsService {
  /**
   * Root directory where downloaded report PDFs are stored locally
   */
  public static getReportsDirectory(): string {
    return `${FileSystem.documentDirectory || FileSystem.cacheDirectory}reports_docs/`;
  }

  /**
   * File path for a given report ID
   */
  public static getReportLocalPath(reportId: string): string {
    const sanitized = reportId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${this.getReportsDirectory()}${sanitized}.pdf`;
  }

  /**
   * Cleanly formats raw portal annotations to a minimal and elegant display title
   * e.g. "Semester Grade Report for 2024-2025-1" -> "Semester Grade Report (2024-2025-1)"
   * e.g. "Cumulative Grade Report upto 2025-2026-3" -> "Cumulative Grade Report (2025-2026-3)"
   */
  public static formatReportTitle(report: ReportItem): string {
    const sem = report.sem ? report.sem.trim() : '';
    const type = report.type ? report.type.trim() : 'Grade Report';

    if (sem) {
      return `${type} (${sem})`;
    }
    return report.annotation || type;
  }

  /**
   * Sorts reports:
   * 1. Cumulative Grade Reports always at top
   * 2. Newest semester first (descending semester string, e.g. 2025-2026-3 > 2025-2026-2)
   */
  public static sortReports(reports: ReportItem[]): ReportItem[] {
    return [...reports].sort((a, b) => {
      const isACumulative = a.type.toLowerCase().includes('cumulative') || a.annotation.toLowerCase().includes('cumulative');
      const isBCumulative = b.type.toLowerCase().includes('cumulative') || b.annotation.toLowerCase().includes('cumulative');

      if (isACumulative && !isBCumulative) return -1;
      if (!isACumulative && isBCumulative) return 1;

      // Descending semester comparison
      return (b.sem || '').localeCompare(a.sem || '');
    });
  }

  /**
   * Formats raw bytes to human readable string
   */
  public static formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  /**
   * Retrieves reports enriched with local file cache status
   */
  public static async getReports(): Promise<ReportItem[]> {
    try {
      const cachedList = await CacheService.getCachedReportsData();
      if (!cachedList || cachedList.length === 0) {
        return [];
      }

      const reportsDir = this.getReportsDirectory();
      const dirInfo = await FileSystem.getInfoAsync(reportsDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(reportsDir, { intermediates: true });
      }

      const results: ReportItem[] = [];

      for (const item of cachedList) {
        const localPath = this.getReportLocalPath(item.id);
        const fileInfo = await FileSystem.getInfoAsync(localPath);

        const isCached = fileInfo.exists && !fileInfo.isDirectory && (fileInfo.size ?? 0) > 512;
        const sizeBytes = isCached ? fileInfo.size : (item.fileSizeBytes || undefined);

        results.push({
          ...item,
          isCached,
          localUri: isCached ? localPath : undefined,
          fileSizeBytes: sizeBytes,
          fileSizeFormatted: this.formatBytes(sizeBytes),
        });
      }

      return this.sortReports(results);
    } catch (e) {
      console.warn('Error reading reports cache:', e);
      return [];
    }
  }

  /**
   * Downloads a PDF report and saves it locally
   */
  public static async downloadReport(
    report: ReportItem,
    onProgress?: (fraction: number) => void
  ): Promise<string> {
    const reportsDir = this.getReportsDirectory();
    const dirInfo = await FileSystem.getInfoAsync(reportsDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(reportsDir, { intermediates: true });
    }

    const finalPath = this.getReportLocalPath(report.id);
    const tempPath = `${finalPath}.tmp`;

    await FileSystem.deleteAsync(tempPath, { idempotent: true });

    const downloadResumable = FileSystem.createDownloadResumable(
      report.file,
      tempPath,
      {},
      (progressEvent) => {
        const total = progressEvent.totalBytesExpectedToWrite || 1;
        const progress = progressEvent.totalBytesWritten / total;
        if (onProgress) {
          onProgress(Math.min(1, Math.max(0, progress)));
        }
      }
    );

    const result = await downloadResumable.downloadAsync();
    if (!result || !result.uri) {
      throw new Error('Download failed to return a valid local file.');
    }

    const downloadedInfo = await FileSystem.getInfoAsync(tempPath);
    if (!downloadedInfo.exists || !downloadedInfo.size || downloadedInfo.size < 512) {
      await FileSystem.deleteAsync(tempPath, { idempotent: true });
      throw new Error('Downloaded report is empty or invalid.');
    }

    // Atomically swap temp to final
    await FileSystem.deleteAsync(finalPath, { idempotent: true });
    await FileSystem.moveAsync({
      from: tempPath,
      to: finalPath,
    });

    // Update CacheService metadata
    const cachedList = (await CacheService.getCachedReportsData()) || [];
    const updated = cachedList.map((r) =>
      r.id === report.id
        ? {
            ...r,
            isCached: true,
            localUri: finalPath,
            fileSizeBytes: downloadedInfo.size,
            fileSizeFormatted: this.formatBytes(downloadedInfo.size),
          }
        : r
    );
    await CacheService.cacheReportsData(updated);

    return finalPath;
  }

  /**
   * Opens the report PDF in an external viewer using Android Intent or iOS Linking
   */
  public static async openReport(
    report: ReportItem,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    const finalPath = this.getReportLocalPath(report.id);
    const fileInfo = await FileSystem.getInfoAsync(finalPath);

    let targetPath = finalPath;
    if (!fileInfo.exists || fileInfo.isDirectory || (fileInfo.size ?? 0) < 512) {
      targetPath = await this.downloadReport(report, onProgress);
    }

    if (Platform.OS === 'android') {
      try {
        const contentUri = await FileSystem.getContentUriAsync(targetPath);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: 'application/pdf',
        });
      } catch (intentErr) {
        console.warn('Intent launcher error for report, falling back to Linking:', intentErr);
        if (report.file) {
          await Linking.openURL(report.file);
        }
      }
    } else {
      if (report.file) {
        await Linking.openURL(report.file);
      }
    }
  }

  /**
   * Clears all downloaded report files from disk
   */
  public static async clearAllReportFiles(): Promise<void> {
    try {
      const dir = this.getReportsDirectory();
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (dirInfo.exists) {
        await FileSystem.deleteAsync(dir, { idempotent: true });
      }
    } catch (e) {
      console.warn('Error clearing report files:', e);
    }
  }
}
