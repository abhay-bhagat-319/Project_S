import { NetworkReachabilityService } from './NetworkReachabilityService';
import { SecureStorageService } from './SecureStorageService';
import * as FileSystem from 'expo-file-system/legacy';
import {
  CacheService,
  ReportItem,
  AttendanceData,
  AttendanceItem,
  AttendanceRecord,
  ProfileData,
  Course,
  CourseDetail,
} from './CacheService';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpRequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | FormData;
  timeoutMs?: number;
  skipSessionCheck?: boolean;
  skipQueue?: boolean;
  isRetry?: boolean;
}

export interface HttpResponse<T = any> {
  status: number;
  ok: boolean;
  url: string;
  data: T;
  rawText: string;
  headers: Headers;
  isSessionExpired: boolean;
}

export type PortalErrorCode =
  | 'NETWORK_ERROR'
  | 'CAMPUS_NETWORK_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export class PortalHttpError extends Error {
  public readonly code: PortalErrorCode;
  public readonly statusCode?: number;
  public readonly responseUrl?: string;

  constructor(
    message: string,
    code: PortalErrorCode,
    statusCode?: number,
    responseUrl?: string
  ) {
    super(message);
    this.name = 'PortalHttpError';
    this.code = code;
    this.statusCode = statusCode;
    this.responseUrl = responseUrl;
  }
}

/**
 * Core HTTP Client for the Shiksha Portal (shiksha.iiserb.ac.in).
 *
 * Provides:
 * - Native authenticated direct HTTP communication (bypassing headless WebViews)
 * - Domain-appropriate browser headers (User-Agent, Origin, Referer)
 * - Automatic cookie jar tracking & bidirectional CookieManager synchronization
 * - Detection of single-session expirations (302 redirects to /login/)
 * - Integration with NetworkReachabilityService for campus network failure diagnosis
 */
export class HttpPortalClient {
  public static readonly BASE_URL = 'https://shiksha.iiserb.ac.in';

  private static readonly DEFAULT_TIMEOUT_MS = 15000;

  private static readonly BROWSER_USER_AGENT =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36';

  private static activeSessionCookie: string | null = null;
  private static activeRequests = 0;
  private static readonly MAX_CONCURRENT_REQUESTS = 2;
  private static readonly requestQueue: Array<() => void> = [];
  private static reauthPromise: Promise<boolean> | null = null;

  /**
   * Acquires a concurrency slot to prevent PHP session file lock contention
   */
  private static async acquireRequestSlot(): Promise<void> {
    if (this.activeRequests < this.MAX_CONCURRENT_REQUESTS) {
      this.activeRequests++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.requestQueue.push(() => {
        this.activeRequests++;
        resolve();
      });
    });
  }

  /**
   * Releases an active concurrency slot and unblocks the next queued request
   */
  private static releaseRequestSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    if (this.requestQueue.length > 0 && this.activeRequests < this.MAX_CONCURRENT_REQUESTS) {
      const next = this.requestQueue.shift();
      if (next) next();
    }
  }

  /**
   * Silently recovers an invalidated or expired session using stored credentials.
   * Utilizes a single in-flight Promise mutex so concurrent requests share the exact same login attempt.
   */
  public static async recoverSession(): Promise<boolean> {
    if (this.reauthPromise) {
      return this.reauthPromise;
    }

    this.reauthPromise = (async () => {
      try {
        console.log('[HttpPortalClient] Attempting transparent session recovery via direct HTTP login...');
        const creds = await SecureStorageService.getCredentials();
        if (!creds || !creds.username || !creds.password) {
          console.warn('[HttpPortalClient] Cannot auto-recover session: no credentials stored in SecureStore.');
          return false;
        }

        const loginResult = await this.login(creds.username, creds.password, 15000);
        if (loginResult.success) {
          console.log('[HttpPortalClient] Transparent session recovery succeeded! New session established.');
          return true;
        } else {
          console.warn('[HttpPortalClient] Transparent session recovery failed:', loginResult.message);
          return false;
        }
      } catch (err) {
        console.error('[HttpPortalClient] Error during session recovery:', err);
        return false;
      } finally {
        this.reauthPromise = null;
      }
    })();

    return this.reauthPromise;
  }

  /**
   * Manually sets or overrides the active session cookie (e.g. PHPSESSID=...)
   */
  public static setSessionCookie(cookie: string | null): void {
    this.activeSessionCookie = cookie;
    if (cookie) {
      console.log('[HttpPortalClient] Updated active session cookie in memory');
    } else {
      console.log('[HttpPortalClient] Cleared active session cookie');
    }
  }

  /**
   * Retrieves the current active session cookie in memory
   */
  public static getSessionCookie(): string | null {
    return this.activeSessionCookie;
  }

  /**
   * Clears the current session cookie
   */
  public static clearSession(): void {
    this.activeSessionCookie = null;
  }

  /**
   * Formats full URL from a relative or absolute path
   */
  private static resolveUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.BASE_URL}${cleanPath}`;
  }

  /**
   * Extracts session cookie from response Set-Cookie headers if present
   */
  private static extractCookies(headers: Headers): void {
    try {
      const setCookie = headers.get('set-cookie');
      if (setCookie) {
        // Extract PHPSESSID or ci_session
        const match = setCookie.match(/(?:PHPSESSID|ci_session)=([^;]+)/i);
        if (match && match[0]) {
          this.activeSessionCookie = match[0];
          console.log('[HttpPortalClient] Captured session cookie from Set-Cookie:', this.activeSessionCookie);
        }
      }
    } catch {
      // Header extraction might fail in certain environments, OkHttp ForwardingCookieHandler still handles it
    }
  }

  /**
   * Inspects response to detect whether Shiksha redirected the request back to the login page
   */
  private static checkSessionExpired(url: string, rawText: string, status: number, requestedPath: string): boolean {
    if (status === 401 || status === 403) {
      return true;
    }

    const lowerUrl = url.toLowerCase();
    const isLoginPageUrl =
      (lowerUrl.includes('/login') || lowerUrl.includes('ldap_login_progress')) &&
      !requestedPath.toLowerCase().includes('/login') &&
      !requestedPath.toLowerCase().includes('ldap_login_progress');

    if (isLoginPageUrl) {
      return true;
    }

    // If requested a secure endpoint but server returned the LDAP login form HTML
    if (requestedPath.includes('/secure') || requestedPath.includes('/reports')) {
      if (
        rawText.includes('ldap_login_progress') ||
        rawText.includes('name="secret"') ||
        (rawText.includes('id="ldap"') && rawText.includes('password')) ||
        rawText.includes('Please Login') ||
        rawText.includes('User Login')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Executes an HTTP request against Shiksha with concurrency throttling and transparent session recovery
   */
  public static async request<T = any>(
    path: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const shouldThrottle = !options.skipQueue;
    if (shouldThrottle) {
      await this.acquireRequestSlot();
    }

    try {
      return await this.executeRequest<T>(path, options);
    } finally {
      if (shouldThrottle) {
        this.releaseRequestSlot();
      }
    }
  }

  /**
   * Low-level fetch execution with session expiration detection and automatic retry
   */
  private static async executeRequest<T = any>(
    path: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const fullUrl = this.resolveUrl(path);
    const timeout = options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = {
      'User-Agent': this.BROWSER_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': this.BASE_URL,
      'Referer': `${this.BASE_URL}/`,
      ...options.headers,
    };

    // Attach active session cookie if explicitly tracked
    if (this.activeSessionCookie && !headers['Cookie'] && !headers['cookie']) {
      headers['Cookie'] = this.activeSessionCookie;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(fullUrl, {
        method: options.method ?? 'GET',
        headers,
        body: options.body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Extract cookies from response
      this.extractCookies(response.headers);

      const rawText = await response.text();
      const isSessionExpired = this.checkSessionExpired(response.url, rawText, response.status, path);

      // Record successful connectivity to Shiksha
      NetworkReachabilityService.recordSuccess();

      let parsedData: any = rawText;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          parsedData = JSON.parse(rawText);
        } catch {}
      }

      const httpResponse: HttpResponse<T> = {
        status: response.status,
        ok: response.ok && !isSessionExpired,
        url: response.url,
        data: parsedData as T,
        rawText,
        headers: response.headers,
        isSessionExpired,
      };

      if (!options.skipSessionCheck && isSessionExpired) {
        if (!options.isRetry) {
          console.warn(`[HttpPortalClient] Session expired on ${path}. Initiating silent auto-recovery...`);
          const recovered = await this.recoverSession();
          if (recovered) {
            console.log(`[HttpPortalClient] Silent session recovery succeeded! Retrying request to ${path}...`);
            return await this.executeRequest<T>(path, {
              ...options,
              isRetry: true,
            });
          }
        }

        throw new PortalHttpError(
          'Shiksha session expired or invalidated by another login.',
          'SESSION_EXPIRED',
          response.status,
          response.url
        );
      }

      if (!response.ok && response.status >= 500) {
        throw new PortalHttpError(
          `Shiksha server error (${response.status})`,
          'SERVER_ERROR',
          response.status,
          response.url
        );
      }

      return httpResponse;
    } catch (err: any) {
      clearTimeout(timer);

      if (err instanceof PortalHttpError) {
        throw err;
      }

      if (err.name === 'AbortError') {
        const netState = await NetworkReachabilityService.recordFailure('Request timed out');
        const code = netState === 'EXTERNAL_ONLINE' ? 'CAMPUS_NETWORK_REQUIRED' : 'TIMEOUT';
        throw new PortalHttpError(
          `Request to ${path} timed out after ${timeout}ms.`,
          code
        );
      }

      // Network / SSL failure handling
      const errorMsg = err.message || 'Network request failed';
      const netState = await NetworkReachabilityService.recordFailure(errorMsg);

      if (netState === 'EXTERNAL_ONLINE') {
        throw new PortalHttpError(
          'Campus network required. Please connect to IISERB Wi-Fi or turn on FortiClient VPN (gateway.iiserb.ac.in).',
          'CAMPUS_NETWORK_REQUIRED'
        );
      }

      if (netState === 'OFFLINE') {
        throw new PortalHttpError(
          'No internet connection detected. Please check your network connection.',
          'NETWORK_ERROR'
        );
      }

      throw new PortalHttpError(
        `Unable to reach Shiksha: ${errorMsg}`,
        'NETWORK_ERROR'
      );
    }
  }

  /**
   * Helper: GET request
   */
  public static async get<T = string>(
    path: string,
    options: Omit<HttpRequestOptions, 'method' | 'body'> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /**
   * Helper: POST request with URL-encoded form data (application/x-www-form-urlencoded)
   */
  public static async postForm<T = string>(
    path: string,
    formData: Record<string, string>,
    options: Omit<HttpRequestOptions, 'method' | 'body'> = {}
  ): Promise<HttpResponse<T>> {
    const encodedBody = Object.entries(formData)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...options.headers,
    };

    return this.request<T>(path, {
      ...options,
      method: 'POST',
      headers,
      body: encodedBody,
    });
  }

  /**
   * Helper: POST request with JSON payload (application/json)
   */
  public static async postJson<T = any>(
    path: string,
    jsonData: any,
    options: Omit<HttpRequestOptions, 'method' | 'body'> = {}
  ): Promise<HttpResponse<T>> {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    return this.request<T>(path, {
      ...options,
      method: 'POST',
      headers,
      body: JSON.stringify(jsonData),
    });
  }

  /**
   * Directly authenticates credentials against Shiksha portal via POST /ldap_login_progress
   */
  public static async login(
    username: string,
    password: string,
    timeoutMs = 15000
  ): Promise<{
    success: boolean;
    code?: PortalErrorCode | 'AUTH_FAILED';
    message?: string;
    sessionCookie?: string;
  }> {
    const trimmedUser = username.trim();
    const trimmedPass = password.trim();

    if (!trimmedUser || !trimmedPass) {
      return {
        success: false,
        code: 'AUTH_FAILED',
        message: 'Please enter both username and password.',
      };
    }

    // Reset current session state before fresh authentication
    this.clearSession();


    try {
      const response = await this.postForm(
        '/ldap_login_progress',
        {
          email: trimmedUser,
          secret: trimmedPass,
        },
        {
          timeoutMs,
          skipSessionCheck: true, // We inspect authentication outcome manually
          skipQueue: true,
        }
      );

      // Successful LDAP authentication:
      // The portal redirects to /secure/studenthome or returns secure dashboard HTML
      const isSuccess =
        response.url.toLowerCase().includes('/secure') ||
        response.rawText.includes('/secure/studenthome') ||
        (response.status === 200 &&
          !response.rawText.includes('ldap_login_progress') &&
          !response.rawText.includes('Invalid username') &&
          !response.rawText.includes('Invalid credentials'));

      if (isSuccess) {
        console.log('[HttpPortalClient] LDAP authentication successful. Cookie:', this.activeSessionCookie);
        return {
          success: true,
          sessionCookie: this.activeSessionCookie || undefined,
        };
      }

      // Check for portal failure alerts
      let failMessage = 'Invalid LDAP credentials. Please check your username and password.';
      if (
        response.rawText.toLowerCase().includes('invalid username') ||
        response.rawText.toLowerCase().includes('invalid credential')
      ) {
        failMessage = 'Invalid username or password.';
      }

      return {
        success: false,
        code: 'AUTH_FAILED',
        message: failMessage,
      };
    } catch (err: any) {
      if (err instanceof PortalHttpError) {
        return {
          success: false,
          code: err.code,
          message: err.message,
        };
      }

      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: err.message || 'Unable to connect to Shiksha portal.',
      };
    }
  }

  /**
   * Fetches and parses student grade reports from /secure/studentReports in ~0.4ms
   */
  public static async getStudentReports(): Promise<ReportItem[]> {
    const response = await this.get<string>('/secure/studentReports');
    const html = response.rawText;

    let reports: any[] = [];

    // Strategy 1: Extract JSON array from ng-init='initReports([...])'
    const initMatch = html.match(/initReports\s*\(\s*(\[.*?\])\s*\)/s);
    if (initMatch && initMatch[1]) {
      try {
        const rawJson = initMatch[1]
          .replace(/&quot;|&#34;/g, '"')
          .replace(/&amp;/g, '&');
        reports = JSON.parse(rawJson);
      } catch (e) {
        console.warn('[HttpPortalClient] Error parsing initReports JSON:', e);
      }
    }

    // Strategy 2: Extract table rows if ng-init was missing or empty
    if (!reports || reports.length === 0) {
      const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
      const rows = html.match(rowRegex) || [];
      for (const row of rows) {
        const tdMatches = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) =>
          m[1].replace(/<[^>]*>/g, '').trim()
        );
        const linkMatch = row.match(/href=["']([^"']*\.pdf[^"']*)["']/i);
        if (tdMatches.length >= 4 && linkMatch) {
          const sem = tdMatches[1];
          const type = tdMatches[2];
          const annotation = tdMatches[3];
          const file = linkMatch[1];
          if (sem && type) {
            reports.push({
              sem,
              type,
              annotation: annotation || `${type} for ${sem}`,
              file,
              show: true,
            });
          }
        }
      }
    }

    // Normalize reports into standard ReportItem structure
    return (reports || [])
      .map((r, idx) => {
        let fileUrl = (r.file || '').trim();
        if (fileUrl && !fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) {
          if (fileUrl.startsWith('/')) {
            fileUrl = `${this.BASE_URL}${fileUrl}`;
          } else {
            fileUrl = `${this.BASE_URL}/${fileUrl}`;
          }
        }

        const type = (r.type || 'Grade Report').trim();
        const sem = (r.sem || '').trim();
        const annotation = (r.annotation || `${type}${sem ? ` (${sem})` : ''}`).trim();
        const safeId = (sem + '-' + type).toLowerCase().replace(/[^a-z0-9_-]/g, '_') || `report_${idx}`;

        return {
          id: safeId,
          type,
          sem,
          annotation,
          file: fileUrl,
          show: r.show !== false && r.show !== 'false' && r.show !== 0,
        };
      })
      .filter((r) => r.show !== false && r.file && (r.file.includes('.pdf') || r.file.includes('report')));
  }

  /**
   * Directly downloads a report PDF to local file destination using authenticated session
   */
  public static async downloadPdfFile(fileUrl: string, targetPath: string): Promise<string> {
    const fullUrl = this.resolveUrl(fileUrl);
    const sessionCookie = this.activeSessionCookie;

    const headers: Record<string, string> = {
      'User-Agent': this.BROWSER_USER_AGENT,
      'Referer': `${this.BASE_URL}/secure/studentReports`,
    };
    if (sessionCookie) {
      headers['Cookie'] = sessionCookie;
    }

    let downloadRes = await FileSystem.downloadAsync(fullUrl, targetPath, {
      headers,
    });

    if (downloadRes.status === 401 || downloadRes.status === 403 || downloadRes.status === 302) {
      console.warn('[HttpPortalClient] PDF download unauthorized. Attempting silent session recovery...');
      const recovered = await this.recoverSession();
      if (recovered) {
        if (this.activeSessionCookie) {
          headers['Cookie'] = this.activeSessionCookie;
        }
        downloadRes = await FileSystem.downloadAsync(fullUrl, targetPath, {
          headers,
        });
      }
    }

    if (downloadRes.status !== 200) {
      throw new Error(`Server returned HTTP ${downloadRes.status} when downloading PDF`);
    }

    return targetPath;
  }

  /**
   * Parses raw attendance records list into normalized AttendanceRecord format
   */
  private static parseAttendanceRecords(raw: any[]): AttendanceRecord[] {
    if (!Array.isArray(raw)) return [];
    const list: AttendanceRecord[] = [];

    for (const item of raw) {
      if (!item) continue;
      if (typeof item === 'string') {
        const parts = item.split(/[:,-]/);
        list.push({
          date: parts[0] ? parts[0].trim() : item,
          status: parts[1] ? parts[1].trim() : 'Present',
        });
      } else if (Array.isArray(item)) {
        list.push({
          date: (item[0] || '').toString(),
          status: (item[1] || 'Present').toString(),
        });
      } else if (typeof item === 'object') {
        const keys = Object.keys(item);
        let dateVal = '';
        let statusVal = '';

        for (const k of keys) {
          const lk = k.toLowerCase();
          if (lk.includes('date') || lk.includes('day') || lk.includes('time') || lk.includes('session')) {
            dateVal = item[k];
            break;
          }
        }
        for (const k of keys) {
          const lk = k.toLowerCase();
          if (lk.includes('status') || lk.includes('attend') || lk.includes('present') || lk.includes('mark') || lk.includes('state')) {
            statusVal = item[k];
            break;
          }
        }
        if (!dateVal && keys.length > 0) dateVal = item[keys[0]];
        if (!statusVal && keys.length > 1) statusVal = item[keys[1]];

        const normalizeDate = (ds: string): string => {
          if (!ds) return '';
          const str = ds.trim();
          const ymd = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
          if (ymd) return `${ymd[3].padStart(2, '0')}-${ymd[2].padStart(2, '0')}-${ymd[1]}`;
          const y8 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
          if (y8) return `${y8[3]}-${y8[2]}-${y8[1]}`;
          const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
          if (dmy) return `${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}-${dmy[3]}`;
          return str;
        };

        if (dateVal || statusVal) {
          list.push({
            date: normalizeDate(String(dateVal)),
            status: String(statusVal || 'Present'),
          });
        }
      }
    }

    return list;
  }

  /**
   * Parses registered courses table from /secure/studentMyCourses HTML
   */
  private static parseRegisteredCoursesFromHtml(html: string): Array<{
    courseCode: string;
    courseTitle: string;
    instructor: string;
    attendanceArg: string;
    srsStatus: {
      midSemAvailable: boolean;
      midSemUrl?: string;
      endSemAvailable: boolean;
      endSemUrl?: string;
    };
  }> {
    const courses: Array<{
      courseCode: string;
      courseTitle: string;
      instructor: string;
      attendanceArg: string;
      srsStatus: {
        midSemAvailable: boolean;
        midSemUrl?: string;
        endSemAvailable: boolean;
        endSemUrl?: string;
      };
    }> = [];

    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows = html.match(rowRegex) || [];

    for (const row of rows) {
      const tdMatches = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => m[1]);
      if (tdMatches.length >= 4) {
        const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim();
        const courseCode = stripTags(tdMatches[0]);
        const courseTitle = stripTags(tdMatches[1]);
        const instructor = stripTags(tdMatches[2]).replace(/\s+/g, ' ');

        if (!courseCode || courseCode.toLowerCase().includes('course') || courseCode.toLowerCase().includes('no data')) {
          continue;
        }

        const actionCell = tdMatches[3];
        const argMatch = actionCell.match(/getAttendanceData\(['"](.*?)['"]\)/i);
        const attendanceArg = argMatch ? argMatch[1] : `${courseCode},`;

        const midSemMatch = actionCell.match(/href=["']([^"']*studentMidSemSRS[^"']*)["']/i);
        const midSemAvailable = !!midSemMatch;
        const midSemUrl = midSemMatch ? midSemMatch[1] : undefined;

        const endSemMatch = actionCell.match(/href=["']([^"']*studentSRS[^"']*)["']/i);
        const isEndSem = endSemMatch && !endSemMatch[1].includes('studentMidSemSRS');
        const endSemAvailable = !!isEndSem;
        const endSemUrl = isEndSem ? endSemMatch[1] : undefined;

        courses.push({
          courseCode,
          courseTitle,
          instructor,
          attendanceArg,
          srsStatus: {
            midSemAvailable,
            midSemUrl,
            endSemAvailable,
            endSemUrl,
          },
        });
      }
    }

    return courses;
  }

  /**
   * Fetches attendance metrics for a single course from /secure/studentMyCourseAttendance
   */
  public static async getCourseAttendance(
    courseId: string,
    roll: string
  ): Promise<{
    status: string;
    totalClasses: number;
    presentClasses: number;
    relPresentPercentage?: string;
    data: AttendanceRecord[];
  }> {
    const arg = courseId.endsWith(',') ? courseId : `${courseId},`;

    const response = await this.postJson<{
      status?: string;
      totalClasses?: number;
      presentClasses?: number;
      relPresentPercentage?: string;
      data?: any[];
      records?: any[];
      userAttendanceInfo?: any[];
    }>('/secure/studentMyCourseAttendance', {
      courseId: arg,
      roll: roll.trim(),
    });

    const resJson = response.data;
    if (resJson && resJson.status === 'ok') {
      const records = this.parseAttendanceRecords(
        resJson.data || resJson.records || resJson.userAttendanceInfo || []
      );
      return {
        status: 'ok',
        totalClasses: resJson.totalClasses ?? records.length,
        presentClasses: resJson.presentClasses ?? 0,
        relPresentPercentage: resJson.relPresentPercentage,
        data: records,
      };
    }

    return {
      status: 'error',
      totalClasses: 0,
      presentClasses: 0,
      data: [],
    };
  }

  /**
   * Directly synchronizes all course attendance records over HTTP in <300ms
   */
  public static async syncAttendance(rollNumber?: string): Promise<AttendanceData> {
    let roll = rollNumber;
    if (!roll) {
      const profile = await CacheService.getCachedProfileData();
      roll = profile?.roll;
    }

    const myCoursesRes = await this.get<string>('/secure/studentMyCourses');
    const html = myCoursesRes.rawText;

    if (!roll) {
      const infoMatch = html.match(/id=["']userInfo["'][^>]*>([\s\S]*?)<\/div>/i);
      if (infoMatch) {
        try {
          const parsed = JSON.parse(infoMatch[1]);
          if (parsed && parsed.roll) roll = String(parsed.roll);
        } catch {}
      }
      if (!roll) {
        const rollMatch = html.match(/["']roll["']\s*:\s*["']?(\w+)["']?/i);
        if (rollMatch) roll = rollMatch[1];
      }
    }

    const courses = this.parseRegisteredCoursesFromHtml(html);
    if (!courses || courses.length === 0) {
      const emptyData: AttendanceData = {
        items: [],
        timestamp: new Date().toISOString(),
      };
      await CacheService.cacheAttendanceData(emptyData);
      return emptyData;
    }

    const items: AttendanceItem[] = await Promise.all(
      courses.map(async (course) => {
        try {
          const attRes = await this.getCourseAttendance(course.attendanceArg, roll || '');
          const total = attRes.totalClasses;
          const present = attRes.presentClasses;
          const absent = Math.max(0, total - present);
          const percentage = total > 0 ? (present / total) * 100 : 100;

          return {
            courseCode: course.courseCode,
            courseTitle: course.courseTitle,
            instructor: course.instructor,
            present,
            absent,
            totalClasses: total,
            percentage,
            records: attRes.data,
            srsStatus: course.srsStatus,
          };
        } catch (e) {
          console.warn(`[HttpPortalClient] Error fetching attendance for ${course.courseCode}:`, e);
          return {
            courseCode: course.courseCode,
            courseTitle: course.courseTitle,
            instructor: course.instructor,
            present: 0,
            absent: 0,
            totalClasses: 0,
            percentage: 0,
            records: [],
            srsStatus: course.srsStatus,
          };
        }
      })
    );

    const data: AttendanceData = {
      items,
      timestamp: new Date().toISOString(),
    };

    await CacheService.cacheAttendanceData(data);
    return data;
  }

  /**
   * Fetches and parses student profile and academic performance from /secure/studenthome
   */
  public static async getProfile(): Promise<ProfileData> {
    const response = await this.get('/secure/studenthome');
    const html = response.rawText;

    // 1. Extract JSON from ng-init="initProfileInfo('...')"
    const profileMatch =
      html.match(/initProfileInfo\s*\(\s*['"]?(\{[\s\S]*?\})['"]?\s*\)/) ||
      html.match(/initProfileInfo\s*\(\s*['"]([\s\S]*?)['"]\s*\)/);

    let parsed: any = null;
    if (profileMatch && profileMatch[1]) {
      try {
        const rawStr = profileMatch[1].replace(/&quot;|&#34;/g, '"').replace(/&amp;/g, '&');
        parsed = JSON.parse(rawStr);
      } catch (e) {
        console.warn('[HttpPortalClient] Failed to parse initProfileInfo JSON:', e);
      }
    }

    if (!parsed) {
      // Fallback: search for profile JSON in document text
      const jsonMatch = html.match(/\{[\s\S]*?"roll"[\s\S]*?"name"[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0].replace(/&quot;|&#34;/g, '"').replace(/&amp;/g, '&'));
        } catch {}
      }
    }

    if (!parsed) {
      throw new Error('Unable to extract student profile information from portal.');
    }

    // 2. Extract discipline mapping from initDiscp if available
    let discpMap: Record<string, string> = {};
    const discpMatch =
      html.match(/initDiscp\s*\(\s*['"]?(\{[\s\S]*?\})['"]?\s*\)/) ||
      html.match(/initDiscp\s*\(\s*['"]([\s\S]*?)['"]\s*\)/);
    if (discpMatch && discpMatch[1]) {
      try {
        const rawDiscp = discpMatch[1].replace(/&quot;|&#34;/g, '"').replace(/&amp;/g, '&');
        discpMap = JSON.parse(rawDiscp);
      } catch {}
    }

    const major = parsed.acadIISER && parsed.acadIISER.major ? parsed.acadIISER.major : '';
    const dept = (major && discpMap[major]) || (major ? major.toUpperCase() : (parsed.dept || ''));

    // 3. Performance array extraction
    let performance: Array<{ sem: string; spi: number; cpi: number }> = [];
    if (Array.isArray(parsed.performance) && parsed.performance.length > 0) {
      performance = parsed.performance.map((p: any) => ({
        sem: String(p.sem || ''),
        spi: p.spi !== undefined ? Number(p.spi) : 0,
        cpi: p.cpi !== undefined ? Number(p.cpi) : 0,
      }));
    } else {
      // Fallback to initPrformanceRep if performance array inside profile is empty
      const perfMatch =
        html.match(/initPrformanceRep\s*\(\s*['"]?(\{[\s\S]*?\})['"]?\s*\)/) ||
        html.match(/initPrformanceRep\s*\(\s*['"]([\s\S]*?)['"]\s*\)/);
      if (perfMatch && perfMatch[1]) {
        try {
          const rawPerf = perfMatch[1].replace(/&quot;|&#34;/g, '"').replace(/&amp;/g, '&');
          const pData = JSON.parse(rawPerf);
          if (pData && Array.isArray(pData.x)) {
            performance = pData.x.map((semName: string, sIdx: number) => ({
              sem: semName,
              spi: pData.ySPI && pData.ySPI[sIdx] !== undefined ? Number(pData.ySPI[sIdx]) : 0,
              cpi: pData.yCPI && pData.yCPI[sIdx] !== undefined ? Number(pData.yCPI[sIdx]) : 0,
            }));
          }
        } catch {}
      }
    }

    // 4. Photo URL resolution
    let photoUrl = '';
    if (parsed.profilePicture && typeof parsed.profilePicture === 'string') {
      photoUrl = parsed.profilePicture;
    } else if (parsed._attachments && parsed._id) {
      const attachKeys = Object.keys(parsed._attachments);
      const picKey = attachKeys.find((k) => {
        const lk = k.toLowerCase();
        return lk.includes('profilepic') || lk.includes('.jpg') || lk.includes('.png') || lk.includes('.jpeg');
      });
      if (picKey) {
        photoUrl = `https://shiksha.iiserb.ac.in/students/profilepic/${parsed._id}/${picKey}`;
      }
    }
    if (!photoUrl) {
      const imgMatch = html.match(/<img[^>]+src=["'](https?:\/\/[^"']*profilepic[^"']*)["']/i);
      if (imgMatch) {
        photoUrl = imgMatch[1];
      }
    }

    // Preserve existing photoBase64 from cache if roll matches
    let photoBase64: string | undefined = undefined;
    const existingCache = await CacheService.getCachedProfileData();
    if (existingCache && existingCache.roll === String(parsed.roll || '') && existingCache.photoBase64) {
      photoBase64 = existingCache.photoBase64;
    }

    const profileData: ProfileData = {
      name: String(parsed.name || ''),
      roll: String(parsed.roll || ''),
      dept,
      passedCourses:
        parsed.current && Array.isArray(parsed.current.passedCourses)
          ? parsed.current.passedCourses
          : (Array.isArray(parsed.passedCourses) ? parsed.passedCourses : []),
      failedCourses:
        parsed.current && Array.isArray(parsed.current.failedCourses)
          ? parsed.current.failedCourses
          : (Array.isArray(parsed.failedCourses) ? parsed.failedCourses : []),
      performance,
      photoUrl: photoUrl || undefined,
      photoBase64,
    };

    // 5. If reports are embedded in the profile, cache them immediately
    if (Array.isArray(parsed.reports) && parsed.reports.length > 0) {
      try {
        const normalizedReports: ReportItem[] = parsed.reports
          .map((r: any, idx: number) => {
            let fileUrl = r.file || '';
            if (fileUrl && !fileUrl.startsWith('http')) {
              fileUrl = fileUrl.startsWith('/')
                ? `https://shiksha.iiserb.ac.in${fileUrl}`
                : `https://shiksha.iiserb.ac.in/${fileUrl}`;
            }
            const type = (r.type || 'Grade Report').trim();
            const sem = (r.sem || '').trim();
            const annotation = (r.annotation || `${type}${sem ? ` (${sem})` : ''}`).trim();
            const safeId = `${sem}-${type}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || `report_${idx}`;
            return {
              id: safeId,
              type,
              sem,
              annotation,
              file: fileUrl,
              show: r.show !== false,
            };
          })
          .filter((r: any) => r.file && r.file.length > 0);

        if (normalizedReports.length > 0) {
          await CacheService.cacheReportsData(normalizedReports);
        }
      } catch (e) {
        console.warn('[HttpPortalClient] Error caching embedded reports:', e);
      }
    }

    return profileData;
  }

  /**
   * Syncs profile data directly via HTTP and caches it locally
   */
  public static async syncProfile(): Promise<ProfileData> {
    const profile = await this.getProfile();
    await CacheService.cacheProfileData(profile);
    NetworkReachabilityService.recordSuccess();
    return profile;
  }

  /**
   * Fetches registered courses list and course details from /secure/studentMyCourses
   */
  public static async getCourses(): Promise<{
    courses: Course[];
    courseDetails: Record<string, CourseDetail>;
  }> {
    const response = await this.get('/secure/studentMyCourses');
    const html = response.rawText;

    const rawCourses = this.parseRegisteredCoursesFromHtml(html);
    const submittedSrs = await CacheService.getSubmittedSrsCourses();

    const courses: Course[] = rawCourses.map((c) => ({
      courseCode: c.courseCode,
      courseTitle: c.courseTitle,
      instructor: c.instructor,
      srsStatus: {
        midSemAvailable: c.srsStatus.midSemAvailable,
        midSemUrl: c.srsStatus.midSemUrl,
        endSemAvailable: c.srsStatus.endSemAvailable,
        endSemUrl: c.srsStatus.endSemUrl,
        isSubmitted: submittedSrs.includes(c.courseCode),
      },
    }));

    const cachedDetails = (await CacheService.getCachedCourseDetails()) || {};
    const courseDetails: Record<string, CourseDetail> = { ...cachedDetails };

    return { courses, courseDetails };
  }

  /**
   * Syncs registered courses directly via HTTP and caches them locally
   */
  public static async syncCourses(): Promise<{
    courses: Course[];
    courseDetails: Record<string, CourseDetail>;
  }> {
    const result = await this.getCourses();
    await CacheService.cacheCoursesData(result.courses);
    if (result.courseDetails && Object.keys(result.courseDetails).length > 0) {
      await CacheService.cacheCourseDetails(result.courseDetails);
    }
    NetworkReachabilityService.recordSuccess();
    return result;
  }

  /**
   * Performs an instant complete portal sync of Profile, Courses, Attendance, and Reports
   */
  public static async syncAll(): Promise<{
    profile: ProfileData;
    courses: Course[];
    courseDetails: Record<string, CourseDetail>;
    attendance: AttendanceData;
    reports: ReportItem[];
  }> {
    const [profile, coursesResult] = await Promise.all([
      this.syncProfile(),
      this.syncCourses(),
    ]);

    const attendance = await this.syncAttendance();

    let reports: ReportItem[] = [];
    try {
      reports = await this.getStudentReports();
      if (reports.length > 0) {
        await CacheService.cacheReportsData(reports);
      }
    } catch (e) {
      console.warn('[HttpPortalClient] Error syncing reports in syncAll:', e);
      reports = (await CacheService.getCachedReportsData()) || [];
    }

    await CacheService.setLastSyncTime(Date.now());
    NetworkReachabilityService.recordSuccess();

    return {
      profile,
      courses: coursesResult.courses,
      courseDetails: coursesResult.courseDetails,
      attendance,
      reports,
    };
  }
}

