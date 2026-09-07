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

const KEY_PROFILE_DATA = 'shiksha_cache_profile';
const KEY_ATTENDANCE_DATA = 'shiksha_cache_attendance';
const KEY_COURSE_DETAILS = 'shiksha_cache_course_details';
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
  // Calculations
  xMiss?: number;
  yAttend?: number;
}

export interface AttendanceData {
  items: AttendanceItem[];
  timestamp: string;
}

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
      const keys = [KEY_PROFILE_DATA, KEY_ATTENDANCE_DATA, KEY_COURSE_DETAILS, KEY_LAST_SYNC_TIME];
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
   * Clear all cache on logout
   */
  async clearCache(): Promise<void> {
    await AsyncStorage.removeItem(KEY_PROFILE_DATA);
    await AsyncStorage.removeItem(KEY_ATTENDANCE_DATA);
    await AsyncStorage.removeItem(KEY_COURSE_DETAILS);
    await AsyncStorage.removeItem(KEY_LAST_SYNC_TIME);
  },
};

