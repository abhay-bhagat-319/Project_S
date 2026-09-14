import { Platform, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DocCategory = 'CALENDAR' | 'TIMETABLE' | 'EXAM' | 'HOLIDAYS';

export interface AcademicDoc {
  id: string;
  title: string;
  category: DocCategory;
  description: string;
  url: string;
  fileName: string;
  isCached: boolean;
  localUri?: string;
  fileSizeBytes?: number;
  fileSizeFormatted?: string;
  etag?: string;
  lastModified?: string;
  lastCheckedAt?: string;
  isUpdating?: boolean;
}

const STORAGE_KEY_METADATA = 'project_s_academic_docs_metadata_v1';

export const DEFAULT_ACADEMIC_DOCS: AcademicDoc[] = [
  {
    id: 'acad_cal_general',
    title: 'Academic Calendar 2026',
    category: 'CALENDAR',
    description: 'Institute-wide schedule for continuing BS-MS / BS / MSc / PhD batches',
    url: 'https://www.iiserb.ac.in/assets/off_academic_affairs/schedule/Academic_Calendar_2026.pdf',
    fileName: 'Academic_Calendar_2026.pdf',
    isCached: false,
  },
  {
    id: 'acad_cal_1st_year',
    title: 'Academic Calendar 2026 (1st Year)',
    category: 'CALENDAR',
    description: 'BS / BTech / BS-MS 1st Year semester schedule and dates',
    url: 'https://www.iiserb.ac.in/assets/off_academic_affairs/schedule/Academic_Calendar_Seme_1st.pdf',
    fileName: 'Academic_Calendar_Seme_1st.pdf',
    isCached: false,
  },
  {
    id: 'class_timetable',
    title: 'Class Time Table 2026-27',
    category: 'TIMETABLE',
    description: 'Semester-wise class schedules, lecture slots & room allocations',
    url: 'https://acad.iiserb.ac.in/pdf_docs/schedule/class_time_table.pdf',
    fileName: 'class_time_table.pdf',
    isCached: false,
  },
  {
    id: 'mid_sem_exam',
    title: 'Mid Semester Exam Schedule',
    category: 'EXAM',
    description: 'Mid-term examination schedule, slot distribution & rooms',
    url: 'https://acad.iiserb.ac.in/pdf/Mid_Sem_Schedule.pdf',
    fileName: 'Mid_Sem_Schedule.pdf',
    isCached: false,
  },
  {
    id: 'end_sem_exam',
    title: 'End Semester Exam Schedule',
    category: 'EXAM',
    description: 'End-term final examination schedule and venues',
    url: 'https://acad.iiserb.ac.in/pdf/End_Semester_Examination_Schedule.pdf',
    fileName: 'End_Semester_Examination_Schedule.pdf',
    isCached: false,
  },
  {
    id: 're_exam_schedule',
    title: 'Re-examination Schedule',
    category: 'EXAM',
    description: 'Supplementary and re-examination schedule',
    url: 'https://www.iiserb.ac.in/assets/all_upload/doaa/Re_examination_2026_Schedule.pdf',
    fileName: 'Re_examination_2026_Schedule.pdf',
    isCached: false,
  },
  {
    id: 'holidays_cal_2026',
    title: 'Holidays Calendar 2026',
    category: 'HOLIDAYS',
    description: 'Official IISER Bhopal annual holidays and restricted holidays',
    url: 'https://www.iiserb.ac.in/assets/all_upload/doaa/Holidays_Calendar_year_2026.pdf',
    fileName: 'Holidays_Calendar_year_2026.pdf',
    isCached: false,
  },
  {
    id: 'holidays_cal_2027',
    title: 'Holidays Calendar 2027',
    category: 'HOLIDAYS',
    description: 'Upcoming academic year holidays list',
    url: 'https://www.iiserb.ac.in/assets/all_upload/doaa/Holidays_Calendar_year_2027.pdf',
    fileName: 'Holidays_Calendar_year_2027.pdf',
    isCached: false,
  },
];

export class AcademicDocsService {
  public static getDocsDirectory(): string {
    return `${FileSystem.documentDirectory || FileSystem.cacheDirectory}academic_docs/`;
  }

  public static getDocLocalPath(docId: string): string {
    return `${this.getDocsDirectory()}${docId}.pdf`;
  }

  public static formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(0)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  /**
   * Retrieves catalogue merged with cached local file info and metadata
   */
  public static async getAcademicDocs(): Promise<AcademicDoc[]> {
    try {
      const storedJson = await AsyncStorage.getItem(STORAGE_KEY_METADATA);
      const metadataMap: Record<string, Partial<AcademicDoc>> = storedJson ? JSON.parse(storedJson) : {};

      const docsDirectory = this.getDocsDirectory();
      const dirInfo = await FileSystem.getInfoAsync(docsDirectory);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(docsDirectory, { intermediates: true });
      }

      const results: AcademicDoc[] = [];

      for (const defaultDoc of DEFAULT_ACADEMIC_DOCS) {
        const meta = metadataMap[defaultDoc.id] || {};
        const localPath = this.getDocLocalPath(defaultDoc.id);
        const fileInfo = await FileSystem.getInfoAsync(localPath);

        const isCached = fileInfo.exists && !fileInfo.isDirectory && (fileInfo.size ?? 0) > 1024;
        const sizeBytes = isCached ? fileInfo.size : (meta.fileSizeBytes || undefined);

        results.push({
          ...defaultDoc,
          ...meta,
          isCached,
          localUri: isCached ? localPath : undefined,
          fileSizeBytes: sizeBytes,
          fileSizeFormatted: this.formatBytes(sizeBytes),
        });
      }

      return results;
    } catch (e) {
      console.warn('Error reading academic docs metadata:', e);
      return DEFAULT_ACADEMIC_DOCS;
    }
  }

  /**
   * Checks HTTP headers (ETag, Last-Modified, Content-Length) via HEAD requests
   * Zero-payload revalidation to detect in-place updates.
   */
  public static async revalidateAllSchedules(): Promise<{
    docs: AcademicDoc[];
    updatedCount: number;
  }> {
    const currentDocs = await this.getAcademicDocs();
    const updatedMetadataMap: Record<string, Partial<AcademicDoc>> = {};
    let updatedCount = 0;
    const nowIso = new Date().toISOString();

    await Promise.all(
      currentDocs.map(async (doc) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Project_S Academic App)',
          };
          if (doc.etag) headers['If-None-Match'] = doc.etag;
          if (doc.lastModified) headers['If-Modified-Since'] = doc.lastModified;

          const response = await fetch(doc.url, {
            method: 'HEAD',
            headers,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (response.status === 304) {
            // Not modified
            updatedMetadataMap[doc.id] = {
              etag: doc.etag,
              lastModified: doc.lastModified,
              fileSizeBytes: doc.fileSizeBytes,
              lastCheckedAt: nowIso,
            };
          } else if (response.ok) {
            const newEtag = response.headers.get('etag') || undefined;
            const newLastMod = response.headers.get('last-modified') || undefined;
            const contentLength = response.headers.get('content-length');
            const newSize = contentLength ? parseInt(contentLength, 10) : undefined;

            const hasChanged = (doc.etag && newEtag && doc.etag !== newEtag) ||
                               (doc.lastModified && newLastMod && doc.lastModified !== newLastMod);

            if (hasChanged && doc.isCached) {
              updatedCount++;
              // File was updated on server, purge stale local file so next tap downloads latest
              if (doc.localUri) {
                await FileSystem.deleteAsync(doc.localUri, { idempotent: true });
              }
            }

            updatedMetadataMap[doc.id] = {
              etag: newEtag || doc.etag,
              lastModified: newLastMod || doc.lastModified,
              fileSizeBytes: newSize || doc.fileSizeBytes,
              lastCheckedAt: nowIso,
            };
          } else {
            updatedMetadataMap[doc.id] = {
              lastCheckedAt: nowIso,
            };
          }
        } catch (err) {
          console.log(`Revalidation error for ${doc.id}:`, err);
          updatedMetadataMap[doc.id] = {
            lastCheckedAt: nowIso,
          };
        }
      })
    );

    await AsyncStorage.setItem(STORAGE_KEY_METADATA, JSON.stringify(updatedMetadataMap));
    const refreshedDocs = await this.getAcademicDocs();
    return { docs: refreshedDocs, updatedCount };
  }

  /**
   * Downloads the PDF file atomically to cache
   */
  public static async downloadDoc(
    docId: string,
    onProgress?: (fraction: number) => void
  ): Promise<string> {
    const docs = await this.getAcademicDocs();
    const doc = docs.find((d) => d.id === docId);
    if (!doc) throw new Error(`Document ${docId} not found in catalogue.`);

    const docsDir = this.getDocsDirectory();
    const dirInfo = await FileSystem.getInfoAsync(docsDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(docsDir, { intermediates: true });
    }

    const finalPath = this.getDocLocalPath(docId);
    const tempPath = `${finalPath}.tmp`;

    await FileSystem.deleteAsync(tempPath, { idempotent: true });

    const downloadResumable = FileSystem.createDownloadResumable(
      doc.url,
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
      throw new Error('Downloaded document is empty or invalid.');
    }

    // Atomically swap temp to final
    await FileSystem.deleteAsync(finalPath, { idempotent: true });
    await FileSystem.moveAsync({
      from: tempPath,
      to: finalPath,
    });

    // Update metadata map
    const storedJson = await AsyncStorage.getItem(STORAGE_KEY_METADATA);
    const metadataMap: Record<string, Partial<AcademicDoc>> = storedJson ? JSON.parse(storedJson) : {};
    metadataMap[docId] = {
      ...(metadataMap[docId] || {}),
      fileSizeBytes: downloadedInfo.size,
      lastCheckedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY_METADATA, JSON.stringify(metadataMap));

    return finalPath;
  }

  /**
   * Opens the document in an external Android PDF viewer using Android Intent
   */
  public static async openDoc(
    docId: string,
    onDownloadProgress?: (fraction: number) => void
  ): Promise<void> {
    const finalPath = this.getDocLocalPath(docId);
    const fileInfo = await FileSystem.getInfoAsync(finalPath);

    let targetPath = finalPath;
    if (!fileInfo.exists || fileInfo.isDirectory || (fileInfo.size ?? 0) < 512) {
      targetPath = await this.downloadDoc(docId, onDownloadProgress);
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
        console.warn('Intent launcher error, falling back to Linking:', intentErr);
        const docs = await this.getAcademicDocs();
        const doc = docs.find((d) => d.id === docId);
        if (doc?.url) {
          await Linking.openURL(doc.url);
        }
      }
    } else {
      const docs = await this.getAcademicDocs();
      const doc = docs.find((d) => d.id === docId);
      if (doc?.url) {
        await Linking.openURL(doc.url);
      }
    }
  }
}
