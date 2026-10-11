import { NetworkReachabilityService } from './NetworkReachabilityService';
import * as FileSystem from 'expo-file-system/legacy';
import { CacheService, ReportItem, AttendanceData, AttendanceItem, AttendanceRecord } from './CacheService';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpRequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | FormData;
  timeoutMs?: number;
  skipSessionCheck?: boolean;
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
    const isLoginPageUrl = lowerUrl.includes('/login') && !requestedPath.toLowerCase().includes('/login');

    if (isLoginPageUrl) {
      return true;
    }

    // If requested a secure endpoint but server returned the LDAP login form HTML
    if (requestedPath.includes('/secure') || requestedPath.includes('/reports')) {
      if (
        rawText.includes('ldap_login_progress') ||
        rawText.includes('name="secret"') ||
        (rawText.includes('id="ldap"') && rawText.includes('password'))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Executes an HTTP request against Shiksha
   */
  public static async request<T = any>(
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
        errorMsg,
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

    const downloadRes = await FileSystem.downloadAsync(fullUrl, targetPath, {
      headers,
    });

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
}

