import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PROFILE_DATA = 'shiksha_cache_profile';
const KEY_ATTENDANCE_DATA = 'shiksha_cache_attendance';
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
}

export interface AttendanceItem {
  courseCode: string;
  courseTitle: string;
  instructor: string;
  present: number;
  absent: number;
  percentage: number;
  totalClasses: number;
  // Calculations
  xMiss?: number; // Safe miss count
  yAttend?: number; // Recovery attend count
}

export interface AttendanceData {
  items: AttendanceItem[];
  timestamp: string;
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
   * Clear all cache on logout
   */
  async clearCache(): Promise<void> {
    await AsyncStorage.removeItem(KEY_PROFILE_DATA);
    await AsyncStorage.removeItem(KEY_ATTENDANCE_DATA);
    await AsyncStorage.removeItem(KEY_LAST_SYNC_TIME);
  },
};
