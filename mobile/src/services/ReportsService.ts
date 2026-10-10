import { Platform, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { CacheService, ReportItem } from './CacheService';
import { NetworkReachabilityService } from './NetworkReachabilityService';
import { SessionLifecycleManager } from './SessionLifecycleManager';
import { HttpPortalClient } from './HttpPortalClient';

export type PdfDownloaderFn = (fileUrl: string, reportId: string) => Promise<string>;

export class ReportsService {
  private static pdfDownloader: PdfDownloaderFn | null = null;
  private static pendingRequests = new Map<string, {
    resolve: (base64: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  /**
   * Registers a bridge handler that can execute ScraperService.getPdfDownloadScript
   * inside an active WebView session to bypass Android native OkHttp SSL trust anchor rejections.
   */
  public static registerPdfDownloader(downloader: PdfDownloaderFn): () => void {
    this.pdfDownloader = downloader;
    return () => {
      if (this.pdfDownloader === downloader) {
        this.pdfDownloader = null;
      }
    };
  }

  /**
   * Dispatches incoming WebView message to any pending PDF download promise.
   * Returns true if the message was handled.
   */
  public static handlePdfMessage(data: { type: string; reportId?: string; base64?: string; message?: string }): boolean {
    if (!data || !data.type) return false;

    if (data.type === 'REPORT_PDF_READY' && data.reportId && data.base64) {
      const pending = this.pendingRequests.get(data.reportId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(data.reportId);
        pending.resolve(data.base64);
        return true;
      }
    } else if (data.type === 'REPORT_PDF_FAILED' && data.reportId) {
      const pending = this.pendingRequests.get(data.reportId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(data.reportId);
        pending.reject(new Error(data.message || 'PDF download failed in WebView session'));
        return true;
      }
    }
    return false;
  }

  /**
   * Creates a pending promise waiting for Base64 data from the WebView.
   */
  public static createPendingPdfDownload(reportId: string, timeoutMs: number = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.pendingRequests.has(reportId)) {
        const old = this.pendingRequests.get(reportId)!;
        clearTimeout(old.timer);
        old.reject(new Error('Superceded by new download request'));
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(reportId);
        reject(new Error('PDF download timed out. Please verify your connection and try again.'));
      }, timeoutMs);

      this.pendingRequests.set(reportId, { resolve, reject, timer });
    });
  }

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

      // Sanitize cached list: only include student-visible reports with valid PDF URLs
      const validReports = cachedList.filter(
        (item) => item.show !== false && item.file && (item.file.toLowerCase().includes('.pdf') || /\.pdf($|\?)/i.test(item.file) || item.file.toLowerCase().includes('report'))
      );

      if (validReports.length !== cachedList.length) {
        CacheService.cacheReportsData(validReports).catch(() => {});
      }

      const results: ReportItem[] = [];

      for (const item of validReports) {
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
   * Synchronizes grade reports from Shiksha over direct HTTP in ~0.4ms
   */
  public static async syncReports(): Promise<ReportItem[]> {
    try {
      const freshReports = await HttpPortalClient.getStudentReports();
      if (freshReports && freshReports.length > 0) {
        await CacheService.cacheReportsData(freshReports);
      }
      return await this.getReports();
    } catch (err) {
      console.warn('[ReportsService] Direct HTTP sync failed:', err);
      return await this.getReports();
    }
  }

  /**
   * Downloads a PDF report directly to disk over HTTP with authenticated session
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
    const fileInfo = await FileSystem.getInfoAsync(finalPath);
    if (fileInfo.exists && !fileInfo.isDirectory && (fileInfo.size ?? 0) > 512) {
      try {
        const header = await FileSystem.readAsStringAsync(finalPath, { length: 5 });
        if (header.startsWith('%PDF')) {
          return finalPath;
        } else {
          await FileSystem.deleteAsync(finalPath, { idempotent: true });
        }
      } catch {
        await FileSystem.deleteAsync(finalPath, { idempotent: true });
      }
    }

    // Pre-flight reachability check
    const isShikshaUp = await NetworkReachabilityService.isShikshaReachable(2000);
    if (!isShikshaUp) {
      const netState = NetworkReachabilityService.getCurrentState();
      if (netState === 'CAMPUS_CAPTIVE') {
        throw new Error('Campus Wi-Fi sign-in required. Please complete captive portal login before downloading reports.');
      }
      throw new Error('Campus network required. Please connect to IISERB Wi-Fi or FortiClient VPN (gateway.iiserb.ac.in).');
    }

    if (onProgress) onProgress(0.2);

    let downloadSuccessful = false;

    // Strategy 1: Direct HTTP Binary Stream (Ultra-fast, ~250ms, zero Base64 overhead)
    try {
      await HttpPortalClient.downloadPdfFile(report.file, finalPath);

      // Verify that downloaded file starts with %PDF magic header
      const header = await FileSystem.readAsStringAsync(finalPath, { length: 5 });
      if (header.startsWith('%PDF')) {
        downloadSuccessful = true;
      } else {
        // Returned HTML (likely redirect to login) - delete and retry after silent re-auth
        await FileSystem.deleteAsync(finalPath, { idempotent: true });
        console.log('[ReportsService] Downloaded file is not PDF, attempting silent re-authentication...');
        const reauthed = await SessionLifecycleManager.silentReauthenticate();
        if (reauthed) {
          await HttpPortalClient.downloadPdfFile(report.file, finalPath);
          const retryHeader = await FileSystem.readAsStringAsync(finalPath, { length: 5 });
          if (retryHeader.startsWith('%PDF')) {
            downloadSuccessful = true;
          }
        }
      }
    } catch (httpErr: any) {
      console.warn('[ReportsService] Direct HTTP PDF download encountered error:', httpErr?.message);
    }

    // Strategy 2: Fallback to WebView Base64 bridge if registered and HTTP failed
    if (!downloadSuccessful && this.pdfDownloader) {
      console.log('[ReportsService] Falling back to WebView PDF downloader bridge...');
      try {
        let base64Data = await this.pdfDownloader(report.file, report.id);
        if (!base64Data || !base64Data.trim().startsWith('JVBER')) {
          const reauthed = await SessionLifecycleManager.silentReauthenticate();
          if (reauthed && this.pdfDownloader) {
            base64Data = await this.pdfDownloader(report.file, report.id);
          }
        }

        if (base64Data && base64Data.trim().startsWith('JVBER')) {
          await FileSystem.writeAsStringAsync(finalPath, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          downloadSuccessful = true;
        }
      } catch (fbErr: any) {
        console.warn('[ReportsService] Fallback WebView download failed:', fbErr?.message);
      }
    }

    if (!downloadSuccessful) {
      await FileSystem.deleteAsync(finalPath, { idempotent: true });
      throw new Error('Failed to download report PDF. Please ensure you are on IISERB Wi-Fi or VPN.');
    }

    if (onProgress) onProgress(1.0);

    const downloadedInfo = await FileSystem.getInfoAsync(finalPath);
    if (!downloadedInfo.exists || !downloadedInfo.size || downloadedInfo.size < 512) {
      await FileSystem.deleteAsync(finalPath, { idempotent: true });
      throw new Error('Downloaded report is empty or invalid.');
    }

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

    let isRealPdf = false;
    if (fileInfo.exists && !fileInfo.isDirectory && (fileInfo.size ?? 0) > 512) {
      try {
        const header = await FileSystem.readAsStringAsync(finalPath, { length: 5 });
        if (header.startsWith('%PDF')) {
          isRealPdf = true;
        } else {
          await FileSystem.deleteAsync(finalPath, { idempotent: true });
        }
      } catch {
        isRealPdf = false;
      }
    }

    let targetPath = finalPath;
    if (!isRealPdf) {
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
