import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CourseDetail {
  courseCode: string;
  courseTitle: string;
  credits: string;
  slot: string;
  instructors: string;
  tutors?: string;
  teachingAssistants?: string;
  prerequisites?: string;
  otherPrerequisites?: string;
  learningObjectives: string[];
  textBooks: string[];
  referenceBooks: string[];
  content: string;
  remark?: string;
}

export interface CourseSRSStatus {
  midSemAvailable: boolean;
  midSemUrl?: string;
  endSemAvailable: boolean;
  endSemUrl?: string;
}

export interface Course {
  courseCode: string;
  courseTitle: string;
  instructor: string;
  srsStatus?: CourseSRSStatus;
  /**
   * Exact argument the portal's own `getAttendanceData('<arg>')` handler used
   * for this course (e.g. "BIO301," or "BIO301,2026-2027-1"). Persisted so an
   * attendance refresh can reuse the cached course list without re-downloading
   * /secure/studentMyCourses and without guessing the argument.
   */
  attendanceArg?: string;
}

export interface ReportItem {
  id: string;
  type: string;
  sem: string;
  annotation: string;
  file: string;
  show?: boolean;
  isCached?: boolean;
  localUri?: string;
  fileSizeBytes?: number;
  fileSizeFormatted?: string;
}

export interface CourseMarkItem {
  componentName: string;
  maxMarks: number;
  scoredMarks?: number;
  weightage?: string;
  grade?: string;
  remarks?: string;
}

export interface CourseMarksData {
  courseCode: string;
  courseTitle?: string;
  components: CourseMarkItem[];
  totalScore?: number;
  totalMax?: number;
  grade?: string;
  lastUpdated?: string;
}

const KEY_PROFILE_DATA = 'shiksha_cache_profile';
const KEY_ATTENDANCE_DATA = 'shiksha_cache_attendance';
const KEY_COURSES_DATA = 'shiksha_cache_courses';
const KEY_COURSE_DETAILS = 'shiksha_cache_course_details';
const KEY_COURSE_MARKS_PREFIX = 'shiksha_cache_marks_';
const KEY_REPORTS_DATA = 'shiksha_cache_reports';
const KEY_LAST_SYNC_TIME = 'shiksha_last_sync_time';

export interface ProfileData {
  name: string;
  roll: string;
  dept: string;
  passedCourses: string[];
  failedCourses: string[];
  performance: Array<{
    sem: string;
    spi: number;
    cpi: number;
  }>;
  photoUrl?: string;
  photoBase64?: string;
}

export interface AttendanceRecord {
  date: string;
  status: string;
}

export interface AttendanceItem {
  courseCode: string;
  courseTitle: string;
  instructor: string;
  present: number;
  absent: number;
  percentage: number;
  totalClasses: number;
  records?: AttendanceRecord[];
  /** Epoch ms of the last successful fetch of this course's attendance. */
  fetchedAt?: number;
  /**
   * True when the latest sync could not refresh this course and the numbers
   * shown are the last known good values. Never rendered as a zero.
   */
  stale?: boolean;
  // Calculations
  xMiss?: number;
  yAttend?: number;
  srsStatus?: CourseSRSStatus;
}

export interface AttendanceData {
  items: AttendanceItem[];
  timestamp: string;
  /** True when at least one course could not be refreshed in the last sync. */
  degraded?: boolean;
  /** Course codes that could not be refreshed (kept from cache). */
  partialFailures?: string[];
}

export type SyncScopeName = 'ALL' | 'PROFILE' | 'ATTENDANCE' | 'COURSES' | 'MARKS' | 'REPORTS';

export interface ScopeStatus {
  /** Epoch ms of the last successful sync of this scope. */
  lastSuccessAt?: number;
  /** Epoch ms of the last sync attempt (successful or not). */
  lastAttemptAt?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
}

const KEY_SYNC_STATUS = 'shiksha_sync_status';

import { UpdateService } from './UpdateService';

export interface CacheStats {
  totalBytes: number;
  formatted: string;
  memoryBytes: number;
  diskBytes: number;
}

export const CacheService = {
  /**
   * Cache student profile details & performance trends
   */
  async cacheProfileData(data: ProfileData): Promise<void> {
    await AsyncStorage.setItem(KEY_PROFILE_DATA, JSON.stringify(data));
  },

  /**
   * Retrieve cached profile data
   */
  async getCachedProfileData(): Promise<ProfileData | null> {
    const raw = await AsyncStorage.getItem(KEY_PROFILE_DATA);
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * Cache course attendance tables and calculations
   */
  async cacheAttendanceData(data: AttendanceData): Promise<void> {
    await AsyncStorage.setItem(KEY_ATTENDANCE_DATA, JSON.stringify(data));
  },

  /**
   * Retrieve cached attendance data
   */
  async getCachedAttendanceData(): Promise<AttendanceData | null> {
    const raw = await AsyncStorage.getItem(KEY_ATTENDANCE_DATA);
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * Cache registered courses list
   */
  async cacheCoursesData(courses: Course[]): Promise<void> {
    await AsyncStorage.setItem(KEY_COURSES_DATA, JSON.stringify(courses));
  },

  /**
   * Retrieve cached registered courses list
   */
  async getCachedCoursesData(): Promise<Course[] | null> {
    const raw = await AsyncStorage.getItem(KEY_COURSES_DATA);
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * Cache detailed course metadata & syllabi
   */
  async cacheCourseDetails(details: Record<string, CourseDetail>): Promise<void> {
    await AsyncStorage.setItem(KEY_COURSE_DETAILS, JSON.stringify(details));
  },

  /**
   * Retrieve cached course details
   */
  async getCachedCourseDetails(): Promise<Record<string, CourseDetail> | null> {
    const raw = await AsyncStorage.getItem(KEY_COURSE_DETAILS);
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * Cache student grade reports metadata
   */
  async cacheReportsData(reports: ReportItem[]): Promise<void> {
    await AsyncStorage.setItem(KEY_REPORTS_DATA, JSON.stringify(reports));
  },

  /**
   * Retrieve cached student grade reports metadata
   */
  async getCachedReportsData(): Promise<ReportItem[] | null> {
    const raw = await AsyncStorage.getItem(KEY_REPORTS_DATA);
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * Save the last successful sync time
   */
  async setLastSyncTime(timestamp: number): Promise<void> {
    await AsyncStorage.setItem(KEY_LAST_SYNC_TIME, timestamp.toString());
  },

  /**
   * Get the last successful sync time (returns 0 if never synced)
   */
  async getLastSyncTime(): Promise<number> {
    const raw = await AsyncStorage.getItem(KEY_LAST_SYNC_TIME);
    return raw ? parseInt(raw, 10) : 0;
  },

  // ---------------------------------------------------------------------------
  // Per-scope sync status
  //
  // A single global "last sync time" cannot express "attendance is 3 minutes old
  // but the profile failed", which is precisely the state the app is in whenever
  // the portal is partially down. These helpers record, per scope, when data was
  // last *successfully* refreshed and what the last failure was.
  // ---------------------------------------------------------------------------

  async getSyncStatusMap(): Promise<Record<string, ScopeStatus>> {
    try {
      const raw = await AsyncStorage.getItem(KEY_SYNC_STATUS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  async getScopeStatus(scope: SyncScopeName): Promise<ScopeStatus | null> {
    const map = await this.getSyncStatusMap();
    return map[scope] || null;
  },

  async markScopeSuccess(scope: SyncScopeName): Promise<void> {
    try {
      const map = await this.getSyncStatusMap();
      const prev = map[scope] || {};
      map[scope] = {
        ...prev,
        lastSuccessAt: Date.now(),
        lastAttemptAt: Date.now(),
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
      };
      await AsyncStorage.setItem(KEY_SYNC_STATUS, JSON.stringify(map));
    } catch {
      // ignore
    }
  },

  async markScopeFailure(scope: SyncScopeName, code: string, message: string): Promise<void> {
    try {
      const map = await this.getSyncStatusMap();
      const prev = map[scope] || {};
      map[scope] = {
        ...prev,
        lastAttemptAt: Date.now(),
        lastErrorCode: code,
        lastErrorMessage: message,
      };
      await AsyncStorage.setItem(KEY_SYNC_STATUS, JSON.stringify(map));
    } catch {
      // ignore
    }
  },

  /**
   * Most recent successful refresh across all scopes (used by the status banner).
   */
  async getLastSuccessAt(): Promise<number | null> {
    const map = await this.getSyncStatusMap();
    let latest: number | null = null;
    for (const status of Object.values(map)) {
      if (status?.lastSuccessAt && (latest === null || status.lastSuccessAt > latest)) {
        latest = status.lastSuccessAt;
      }
    }
    const fallback = await this.getLastSyncTime();
    if (!latest && fallback) return fallback;
    return latest;
  },

  /**
   * True when the given scope has never synced or is older than `ttlMs`.
   */
  async isScopeStale(scope: SyncScopeName, ttlMs: number): Promise<boolean> {
    const status = await this.getScopeStatus(scope);
    if (!status?.lastSuccessAt) return true;
    return Date.now() - status.lastSuccessAt >= ttlMs;
  },

  /**
   * Verify if sync is cooled down (true if more than 24 hours have passed)
   */
  async isSyncCooledDown(): Promise<boolean> {
    const lastSync = await this.getLastSyncTime();
    if (lastSync === 0) return true;
    const now = Date.now();
    const cooldownMs = 24 * 60 * 60 * 1000; // 24 Hours
    return now - lastSync >= cooldownMs;
  },

  /**
   * Calculates total cache footprint across AsyncStorage data and FileSystem APK downloads
   */
  async getCacheStats(): Promise<CacheStats> {
    try {
      const keys = [KEY_PROFILE_DATA, KEY_ATTENDANCE_DATA, KEY_COURSES_DATA, KEY_COURSE_DETAILS, KEY_REPORTS_DATA, KEY_LAST_SYNC_TIME, KEY_SYNC_STATUS];
      let memoryBytes = 0;
      for (const k of keys) {
        const item = await AsyncStorage.getItem(k);
        if (item) {
          memoryBytes += item.length * 2;
        }
      }

      const diskBytes = await UpdateService.getTotalUpdateStorageBytes();
      const totalBytes = memoryBytes + diskBytes;

      let formatted = '0 KB';
      if (totalBytes > 1024 * 1024) {
        formatted = `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
      } else if (totalBytes > 0) {
        formatted = `${Math.max(1, Math.round(totalBytes / 1024))} KB`;
      }

      return { totalBytes, formatted, memoryBytes, diskBytes };
    } catch {
      return { totalBytes: 0, formatted: '0 KB', memoryBytes: 0, diskBytes: 0 };
    }
  },

  /**
   * Cache course marks data for an individual course
   */
  async cacheCourseMarks(courseCode: string, data: CourseMarksData): Promise<void> {
    try {
      await AsyncStorage.setItem(`${KEY_COURSE_MARKS_PREFIX}${courseCode}`, JSON.stringify(data));
    } catch (e) {
      console.error('Error caching course marks:', e);
    }
  },

  /**
   * Get cached course marks data for an individual course
   */
  async getCachedCourseMarks(courseCode: string): Promise<CourseMarksData | null> {
    try {
      const raw = await AsyncStorage.getItem(`${KEY_COURSE_MARKS_PREFIX}${courseCode}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  /**
   * Clear all cache on logout or user reset (wipes AsyncStorage, update files, and report files)
   */
  async clearCache(): Promise<void> {
    // Remove every key this service owns, including the per-course marks entries
    // and course-list cache (previously missed here, which leaked the previous
    // user's course list across a log-out / log-in cycle).
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const owned = allKeys.filter(
        (k) =>
          k === KEY_PROFILE_DATA ||
          k === KEY_ATTENDANCE_DATA ||
          k === KEY_COURSES_DATA ||
          k === KEY_COURSE_DETAILS ||
          k === KEY_REPORTS_DATA ||
          k === KEY_LAST_SYNC_TIME ||
          k === KEY_SYNC_STATUS ||
          k.startsWith(KEY_COURSE_MARKS_PREFIX)
      );
      if (owned.length > 0) {
        await AsyncStorage.multiRemove(owned);
      }
    } catch {
      // Fall back to explicit removals if getAllKeys is unavailable
      await AsyncStorage.removeItem(KEY_PROFILE_DATA);
      await AsyncStorage.removeItem(KEY_ATTENDANCE_DATA);
      await AsyncStorage.removeItem(KEY_COURSES_DATA);
      await AsyncStorage.removeItem(KEY_COURSE_DETAILS);
      await AsyncStorage.removeItem(KEY_REPORTS_DATA);
      await AsyncStorage.removeItem(KEY_LAST_SYNC_TIME);
      await AsyncStorage.removeItem(KEY_SYNC_STATUS);
    }

    await UpdateService.clearAllUpdateFiles();
    try {
      const { ReportsService } = require('./ReportsService');
      await ReportsService.clearAllReportFiles();
    } catch {}
  },
};

