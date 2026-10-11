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
  CourseSRSStatus,
} from './CacheService';
import { SyncDiagnostics } from './SyncDiagnostics';
import { normalizeCourseAttendance } from '../utils/attendanceNormalizer';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpRequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | FormData;
  timeoutMs?: number;
  skipSessionCheck?: boolean;
  skipQueue?: boolean;
  skipCircuitBreaker?: boolean;
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
  | 'SESSION_EXPIRED'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'PARSE_ERROR'
  | 'EMPTY_RESPONSE'
  | 'CIRCUIT_OPEN'
  | 'UNKNOWN';

/** Scopes that can be synchronized independently. */
export type PortalSyncScope = 'PROFILE' | 'COURSES' | 'ATTENDANCE' | 'REPORTS';

export interface PortalSyncError {
  scope: PortalSyncScope;
  code: PortalErrorCode;
  message: string;
}

export interface PortalSyncAllResult {
  /** Null when that scope failed; cached data was preserved in that case. */
  profile: ProfileData | null;
  courses: Course[] | null;
  courseDetails: Record<string, CourseDetail> | null;
  attendance: AttendanceData | null;
  reports: ReportItem[] | null;
  errors: PortalSyncError[];
}

export const COURSE_ENTRY_TIMEOUT_MS = 6000;

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
 */
export class HttpPortalClient {
  public static readonly BASE_URL = 'https://shiksha.iiserb.ac.in';

  private static readonly DEFAULT_TIMEOUT_MS = 10000;

  private static readonly BROWSER_USER_AGENT =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36';

  private static activeSessionCookie: string | null = null;
  private static activeRequests = 0;
  /**
   * Shiksha runs on PHP with file-backed sessions, which serialise on the
   * session file lock server-side. Fanning out further than this only queues
   * requests inside the server (and burns the client-side timeout budget), so
   * the cap is deliberately small.
   */
  private static readonly MAX_CONCURRENT_REQUESTS = 4;
  private static readonly QUEUE_WATCHDOG_MS = 20000;
  private static readonly requestQueue: Array<() => void> = [];
  private static reauthPromise: Promise<boolean> | null = null;

  // --- Portal health / circuit breaker -------------------------------------
  // During a portal outage (e.g. the AngularJS data backend behind
  // /secure/studentMyCourses is down while /secure/studenthome still renders),
  // every refresh previously waited the full 10s timeout and then failed
  // silently. The breaker lets the UI fail fast with a clear reason once the
  // portal has proven unhealthy, while still probing for recovery.
  private static readonly FAILURE_THRESHOLD = 3;
  private static readonly CIRCUIT_COOLDOWN_MS = 45000;
  private static failureStreak = 0;
  private static circuitOpenedAt = 0;
  private static probeInFlight = false;
  private static lastLoginAt = 0;
  private static readonly LOGIN_COOLDOWN_MS = 20000;

  /**
   * Acquires a concurrency slot to prevent PHP session file lock contention
   */
  private static async acquireRequestSlot(): Promise<void> {
    if (this.activeRequests < this.MAX_CONCURRENT_REQUESTS) {
      this.activeRequests++;
      return;
    }

    return new Promise<void>((resolve) => {
      const entry = () => {
        clearTimeout(watchdog);
        this.activeRequests++;
        resolve();
      };
      // Watchdog: a slot can never be lost forever, otherwise one hung request
      // would block every subsequent request for the rest of the session.
      const watchdog = setTimeout(() => {
        const idx = this.requestQueue.indexOf(entry);
        if (idx >= 0) this.requestQueue.splice(idx, 1);
        console.warn('[HttpPortalClient] Request queue watchdog fired; releasing slot.');
        this.activeRequests++;
        resolve();
      }, this.QUEUE_WATCHDOG_MS);

      this.requestQueue.push(entry);
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
   * Resets the request queue and active counter in case of catastrophic network drop or retry
   */
  public static resetQueue(): void {
    this.activeRequests = 0;
    while (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift();
      if (next) next();
    }
  }

  /**
   * Silently recovers an invalidated or expired session using stored credentials.
   *
   * Shiksha allows only ONE active session per student, so re-authenticating is
   * a destructive operation for every other holder of the old cookie (the
   * Portal WebView, a second request in flight...). This method therefore:
   *   1. shares a single in-flight login across all callers (mutex), and
   *   2. refuses to start another login within LOGIN_COOLDOWN_MS of the last one,
   * which prevents the "each side evicts the other's session" ping-pong.
   */
  public static async recoverSession(): Promise<boolean> {
    if (this.reauthPromise) {
      return this.reauthPromise;
    }

    const sinceLastLogin = Date.now() - this.lastLoginAt;
    if (this.lastLoginAt > 0 && sinceLastLogin < this.LOGIN_COOLDOWN_MS) {
      SyncDiagnostics.log({
        kind: 'auth',
        label: 'recoverSession',
        ok: false,
        detail: `suppressed (cooldown, ${Math.round((this.LOGIN_COOLDOWN_MS - sinceLastLogin) / 1000)}s left)`,
      });
      return false;
    }

    this.reauthPromise = (async () => {
      try {
        console.log('[HttpPortalClient] Attempting transparent session recovery via direct HTTP login...');
        const creds = await SecureStorageService.getCredentials();
        if (!creds || !creds.username || !creds.password) {
          console.warn('[HttpPortalClient] Cannot auto-recover session: no credentials stored in SecureStore.');
          SyncDiagnostics.log({ kind: 'auth', label: 'recoverSession', ok: false, detail: 'no stored credentials' });
          return false;
        }

        const loginResult = await this.login(creds.username, creds.password, 15000);
        if (loginResult.success) {
          this.lastLoginAt = Date.now();
          console.log('[HttpPortalClient] Transparent session recovery succeeded! New session established.');
          SyncDiagnostics.log({ kind: 'auth', label: 'recoverSession', ok: true });
          return true;
        } else {
          console.warn('[HttpPortalClient] Transparent session recovery failed:', loginResult.message);
          SyncDiagnostics.log({
            kind: 'auth',
            label: 'recoverSession',
            ok: false,
            detail: loginResult.code || loginResult.message || 'unknown',
          });
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
   * True when the portal has accumulated enough recent failures that new
   * requests should fail fast instead of waiting for a timeout.
   */
  public static isCircuitOpen(): boolean {
    if (this.failureStreak < this.FAILURE_THRESHOLD) return false;
    // Still inside the cooldown window → stay open.
    if (Date.now() - this.circuitOpenedAt < this.CIRCUIT_COOLDOWN_MS) return true;
    // Cooldown elapsed → half-open: allow exactly one probe.
    return this.probeInFlight;
  }

  /**
   * Marks a single half-open probe when the circuit cooldown has elapsed.
   */
  private static takeHalfOpenProbe(): boolean {
    if (this.failureStreak < this.FAILURE_THRESHOLD) return false;
    if (Date.now() - this.circuitOpenedAt < this.CIRCUIT_COOLDOWN_MS) return false;
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  private static recordRequestSuccess(): void {
    this.failureStreak = 0;
    this.circuitOpenedAt = 0;
    this.probeInFlight = false;
  }

  private static recordRequestFailure(code: PortalErrorCode): void {
    if (code !== 'TIMEOUT' && code !== 'NETWORK_ERROR' && code !== 'SERVER_ERROR') {
      return;
    }
    this.failureStreak++;
    if (this.failureStreak >= this.FAILURE_THRESHOLD) {
      this.circuitOpenedAt = Date.now();
      SyncDiagnostics.log({
        kind: 'circuit',
        label: 'portal',
        ok: false,
        detail: `opened after ${this.failureStreak} consecutive failures (${code})`,
      });
    }
  }

  /** Snapshot of portal health, exposed for diagnostics/UIs. */
  public static getPortalHealth(): { failureStreak: number; circuitOpen: boolean; sinceLastLoginMs: number } {
    return {
      failureStreak: this.failureStreak,
      circuitOpen: this.isCircuitOpen(),
      sinceLastLoginMs: this.lastLoginAt ? Date.now() - this.lastLoginAt : -1,
    };
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
        // Extract connect.sid (Express backend), PHPSESSID, or ci_session
        const match = setCookie.match(/(?:connect\.sid|PHPSESSID|ci_session)=([^;]+)/i);
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
    if (status === 401) {
      return true;
    }

    // A 403 is NOT proof of an expired session (it can be CSRF/permission), and
    // treating it as one previously triggered a needless full re-login — which,
    // on a single-session portal, logs the user out everywhere else.
    if (status === 403 && url.toLowerCase().includes('/login')) {
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
   * Executes an HTTP request against Shiksha with circuit-breaker fast-fail,
   * concurrency throttling, diagnostics and transparent session recovery.
   */
  private static async executeRequest<T = any>(
    path: string,
    options: HttpRequestOptions = {},
    startedAt: number = Date.now()
  ): Promise<HttpResponse<T>> {
    if (!options.skipCircuitBreaker && this.isCircuitOpen()) {
      SyncDiagnostics.log({
        kind: 'circuit',
        label: path,
        ok: false,
        detail: 'fast-fail (portal unhealthy)',
      });
      throw new PortalHttpError(
        'Shiksha is not responding right now. Showing saved data — tap refresh to try again.',
        'CIRCUIT_OPEN'
      );
    }

    const halfOpenProbe = this.takeHalfOpenProbe();
    const startedAtMs = Date.now();

    try {
      const response = await this.performRequest<T>(path, options, startedAt);
      this.recordRequestSuccess();
      SyncDiagnostics.log({
        kind: 'request',
        label: path,
        ok: true,
        status: response.status,
        ms: Date.now() - startedAtMs,
      });
      return response;
    } catch (err: any) {
      const code: PortalErrorCode =
        err instanceof PortalHttpError ? err.code : 'UNKNOWN';
      this.recordRequestFailure(code);
      SyncDiagnostics.log({
        kind: 'request',
        label: path,
        ok: false,
        ms: Date.now() - startedAtMs,
        detail: `${code}: ${err?.message || err}`,
      });
      throw err;
    } finally {
      if (halfOpenProbe) {
        this.probeInFlight = false;
      }
    }
  }

  /**
   * Low-level fetch execution with session expiration detection and automatic retry
   */
  private static async performRequest<T = any>(
    path: string,
    options: HttpRequestOptions = {},
    startedAt: number = Date.now()
  ): Promise<HttpResponse<T>> {
    const fullUrl = this.resolveUrl(path);
    const timeout = options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = {
      'User-Agent': this.BROWSER_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': this.BASE_URL,
      'Referer': `${this.BASE_URL}/`,
      // The WebView's own fetch() calls sent this; some CodeIgniter/Angular
      // endpoints branch on it. Harmless if unused, cheaper than being served
      // an HTML wrapper instead of JSON.
      'X-Requested-With': 'XMLHttpRequest',
      ...options.headers,
    };

    // NOTE: cookies are managed by React Native's networking stack
    // (ReactCookieJarContainer + ForwardingCookieHandler ⇄ android.webkit.CookieManager),
    // which is shared with the Portal WebView. OkHttp's BridgeInterceptor REPLACES
    // an explicitly-set Cookie header with the jar's cookies, so the value below
    // is only a fallback used when the jar has nothing for this host.
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
        redirect: 'follow',
        credentials: 'include',
      });

      clearTimeout(timer);

      // Extract cookies from response
      this.extractCookies(response.headers);

      const rawText = await response.text();
      const isSessionExpired = this.checkSessionExpired(response.url, rawText, response.status, path);

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
        // Retry at most once, and only against the session state this request
        // actually started with. If a re-login already completed after this
        // request began, retrying would just be evicted again (session
        // ping-pong), so surface the expiry instead.
        const loginIsStale = this.lastLoginAt >= startedAt;
        if (!options.isRetry && !loginIsStale) {
          console.warn(`[HttpPortalClient] Session expired on ${path}. Initiating silent auto-recovery...`);
          const recovered = await this.recoverSession();
          if (recovered) {
            console.log(`[HttpPortalClient] Silent session recovery succeeded! Retrying request to ${path}...`);
            return await this.executeRequest<T>(path, {
              ...options,
              isRetry: true,
            }, startedAt);
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

      // NOTE: the request queue is intentionally NOT reset here. The queue slot
      // is always released in request()'s finally block, and a slot acquired by
      // a hung call is recovered by the queue watchdog in acquireRequestSlot().
      // Wiping the queue on every transport error released every waiter at once,
      // which defeated throttling exactly when the server was already struggling.

      const errMsg = String(err?.message || '');
      const isAbort =
        err?.name === 'AbortError' ||
        errMsg.toLowerCase().includes('canceled') ||
        errMsg.toLowerCase().includes('cancelled') ||
        errMsg.toLowerCase().includes('aborted');

      if (isAbort) {
        throw new PortalHttpError(
          `Request to ${path} timed out. Please check campus connection and retry.`,
          'TIMEOUT'
        );
      }

      throw new PortalHttpError(
        'Unable to reach Shiksha portal. Connect to campus network and retry.',
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

      // Diagnostic: log what the server actually returned so we can debug auth failures
      const responseUrlLower = response.url.toLowerCase();
      const rawTextLower = response.rawText.toLowerCase();
      const htmlSnippet = response.rawText.substring(0, 500);
      console.log(`[HttpPortalClient] Login response → status=${response.status}, url=${response.url}`);
      console.log(`[HttpPortalClient] Login response HTML (first 500 chars): ${htmlSnippet}`);
      console.log(`[HttpPortalClient] Active cookie after login: ${this.activeSessionCookie}`);

      // 1. Check for explicit FAILURE indicators first (these are definitive)
      const hasExplicitError =
        rawTextLower.includes('invalid username') ||
        rawTextLower.includes('invalid credential') ||
        rawTextLower.includes('incorrect ldap') ||
        rawTextLower.includes('authentication failed') ||
        rawTextLower.includes('login failed') ||
        rawTextLower.includes('invalid password') ||
        rawTextLower.includes('wrong password');

      if (hasExplicitError) {
        console.warn('[HttpPortalClient] Login FAILED: explicit error string found in response body.');
        return {
          success: false,
          code: 'AUTH_FAILED',
          message: 'Invalid username or password.',
        };
      }

      // 2. Parse the hidden status field that Shiksha's AngularJS login controller reads
      //    <input type="hidden" value="ok" id="status"/>  → success
      //    <input type="hidden" value="error" id="status"/> → failure (or missing)
      const statusFieldMatch = response.rawText.match(
        /id=["']status["'][^>]*value=["']([^"']+)["']|value=["']([^"']+)["'][^>]*id=["']status["']/i
      );
      const hiddenStatusValue = (statusFieldMatch?.[1] || statusFieldMatch?.[2] || '').toLowerCase().trim();
      console.log(`[HttpPortalClient] Hidden status field value: "${hiddenStatusValue}"`);

      // 3. Check for positive SUCCESS signals
      const urlIndicatesSecure = responseUrlLower.includes('/secure');
      const bodyReferencesSecure =
        response.rawText.includes('/secure/studenthome') ||
        response.rawText.includes('/secure/studentMyCourses') ||
        response.rawText.includes('/secure/studentReports');
      const hiddenStatusOk = hiddenStatusValue === 'ok';
      const hasSessionCookie = !!this.activeSessionCookie;

      const isSuccess =
        urlIndicatesSecure ||
        bodyReferencesSecure ||
        hiddenStatusOk;

      console.log(`[HttpPortalClient] Login verdict → urlSecure=${urlIndicatesSecure}, bodySecure=${bodyReferencesSecure}, hiddenOk=${hiddenStatusOk}, hasCookie=${hasSessionCookie}, isSuccess=${isSuccess}`);

      if (isSuccess) {
        // The server authenticated us but uses a JS redirect instead of HTTP 302.
        // OkHttp's internal cookie jar has the session cookie even though fetch() can't
        // expose Set-Cookie headers to JS. Make a follow-up GET to /secure/studenthome
        // to confirm the session is alive and let OkHttp attach cookies automatically.
        try {
          console.log('[HttpPortalClient] Auth OK — confirming session via GET /secure/studenthome...');
          const confirmResponse = await this.get('/secure/studenthome', {
            timeoutMs: 10000,
            skipSessionCheck: true,
            skipQueue: true,
          });

          // Extract any cookie from the confirmation response
          this.extractCookies(confirmResponse.headers);

          const confirmUrlLower = confirmResponse.url.toLowerCase();
          if (
            confirmUrlLower.includes('/secure') ||
            confirmResponse.rawText.includes('/secure/studenthome')
          ) {
            console.log('[HttpPortalClient] Session confirmed! Cookie:', this.activeSessionCookie);
            return {
              success: true,
              sessionCookie: this.activeSessionCookie || undefined,
            };
          } else {
            // Session confirmation failed — server didn't actually create a session
            console.warn('[HttpPortalClient] Session confirmation failed. Confirm URL:', confirmResponse.url);
            console.warn('[HttpPortalClient] Confirm HTML snippet:', confirmResponse.rawText.substring(0, 300));
            return {
              success: false,
              code: 'AUTH_FAILED',
              message: 'Authentication succeeded but session could not be established. Please try again.',
            };
          }
        } catch (confirmErr: any) {
          console.warn('[HttpPortalClient] Session confirmation request failed:', confirmErr.message);
          // Even if confirmation fails, the auth itself succeeded
          return {
            success: true,
            sessionCookie: this.activeSessionCookie || undefined,
          };
        }
      }

      // 4. If we reached here, the login page was re-rendered with no success/error indicators
      console.warn('[HttpPortalClient] Login AMBIGUOUS: no success or error indicators detected.');
      console.warn('[HttpPortalClient] Full response body for debugging:', response.rawText.substring(0, 2000));

      return {
        success: false,
        code: 'AUTH_FAILED',
        message: 'Invalid LDAP credentials. Please check your username and password.',
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
    const normalized = (reports || [])
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

    if (reports.length > 0 && normalized.length === 0) {
      // The portal listed reports but none survived normalization — most likely
      // the file URL/id shape changed. Log it instead of silently showing an
      // empty Reports tab.
      SyncDiagnostics.log({
        kind: 'sync',
        label: 'REPORTS',
        ok: false,
        detail: `parsed ${reports.length} entries, none usable after normalization`,
      });
    }

    return normalized;
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
   * Fetches attendance metrics for a single course from /secure/studentMyCourseAttendance.
   *
   * The response contract is treated as *tolerant* on purpose: the legacy
   * WebView scraper derived counts from the record list and accepted several
   * envelope shapes, whereas the previous native implementation required
   * `status === 'ok'` and `presentClasses` to be a number. Anything else — a
   * different status token, counts serialised as strings, or only
   * `relPresentPercentage` — was silently rendered as 0 present out of N total,
   * i.e. a 0 % attendance card. That is a display bug, not a data truth.
   */
  public static async getCourseAttendance(
    courseId: string,
    roll: string,
    options: { timeoutMs?: number } = {}
  ): Promise<{
    status: 'ok' | 'empty' | 'error';
    totalClasses: number;
    presentClasses: number;
    relPresentPercentage?: string;
    data: AttendanceRecord[];
  }> {
    const arg = courseId.endsWith(',') ? courseId : `${courseId},`;

    const response = await this.postJson<{
      status?: string;
      totalClasses?: number | string;
      presentClasses?: number | string;
      present?: number | string;
      total?: number | string;
      relPresentPercentage?: string | number;
      data?: any[];
      records?: any[];
      userAttendanceInfo?: any[];
      relPresentdays?: any[];
    }>('/secure/studentMyCourseAttendance', {
      courseId: arg,
      roll: roll.trim(),
    }, { timeoutMs: options.timeoutMs ?? COURSE_ENTRY_TIMEOUT_MS });

    const resJson: any = response.data;

    if (!resJson || typeof resJson !== 'object') {
      return { status: 'error', totalClasses: 0, presentClasses: 0, data: [] };
    }

    const records = this.parseAttendanceRecords(
      resJson.data || resJson.records || resJson.userAttendanceInfo || resJson.relPresentdays || []
    );

    // Pure, unit-tested normalisation (see utils/attendanceNormalizer.ts).
    const normalized = normalizeCourseAttendance(resJson, records);

    return {
      status: normalized.status === 'error' ? 'error' : normalized.status,
      totalClasses: normalized.totalClasses,
      presentClasses: normalized.presentClasses,
      relPresentPercentage: normalized.relPresentPercentage,
      data: records,
    };
  }

  /**
   * Runs `fn` over `items` with a hard concurrency cap, collecting results in
   * input order. Used for the per-course attendance fan-out.
   */
  private static async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
  ): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
    const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
    let cursor = 0;

    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        try {
          results[index] = { ok: true, value: await fn(items[index], index) };
        } catch (error) {
          results[index] = { ok: false, error };
        }
      }
    });

    await Promise.all(workers);
    return results;
  }

  /**
   * Synchronizes course attendance over HTTP.
   *
   * Behavioural guarantees (these are the fixes for the "attendance never
   * refreshes / shows nothing" reports):
   *  1. A failed course keeps its last known good numbers and is flagged
   *     `stale` — it is never written as 0/0.
   *  2. If *every* course fails, the previous cache is left untouched and a
   *     typed error is thrown so the UI can explain why.
   *  3. Courses are fetched with a bounded concurrency and delivered through
   *     `onCourse` as they arrive, so the first card updates in ~300-400ms
   *     instead of waiting for the slowest request.
   *  4. The course list can be supplied by the caller (cached), avoiding a full
   *     /secure/studentMyCourses page fetch on every pull-to-refresh.
   */
  public static async syncAttendance(options: {
    rollNumber?: string;
    courses?: Array<{
      courseCode: string;
      courseTitle: string;
      instructor: string;
      attendanceArg?: string;
      srsStatus?: CourseSRSStatus;
    }>;
    concurrency?: number;
    timeoutMs?: number;
    onCourse?: (item: AttendanceItem) => void;
    /** Skip writing the result to cache (used by dry-run diagnostics). */
    skipCache?: boolean;
  } = {}): Promise<AttendanceData> {
    const startedAt = Date.now();
    const previous = await CacheService.getCachedAttendanceData();
    const previousByCode = new Map<string, AttendanceItem>(
      (previous?.items || []).map((item) => [item.courseCode, item])
    );

    let roll = options.rollNumber;
    if (!roll) {
      const profile = await CacheService.getCachedProfileData();
      roll = profile?.roll;
    }

    let courses = options.courses;

    if (!courses || courses.length === 0) {
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

      const parsedCourses = this.parseRegisteredCoursesFromHtml(html);
      if (!parsedCourses || parsedCourses.length === 0) {
        const pageLooksRendered = /id=["']dataTable["']/i.test(html) || /no\s*data/i.test(html);
        const message = pageLooksRendered
          ? 'The portal rendered your course list without any registered courses.'
          : 'Could not read your course list from the portal response.';
        if (!options.skipCache) {
          await CacheService.markScopeFailure('ATTENDANCE', 'EMPTY_RESPONSE', message);
        }
        throw new PortalHttpError(message, 'EMPTY_RESPONSE');
      }
      courses = parsedCourses;
    }

    if (!roll) {
      const message = 'Missing roll number — sign in again so the app can read your profile.';
      if (!options.skipCache) {
        await CacheService.markScopeFailure('ATTENDANCE', 'PARSE_ERROR', message);
      }
      throw new PortalHttpError(message, 'PARSE_ERROR');
    }

    const resolvedRoll = roll;
    const timeoutMs = options.timeoutMs ?? COURSE_ENTRY_TIMEOUT_MS;
    const concurrency = options.concurrency ?? this.MAX_CONCURRENT_REQUESTS;

    const failures: string[] = [];

    const settled = await this.mapWithConcurrency(courses, concurrency, async (course) => {
      const attendanceArg = course.attendanceArg || `${course.courseCode},`;
      const attRes = await this.getCourseAttendance(attendanceArg, resolvedRoll, { timeoutMs });

      if (attRes.status === 'empty') {
        throw new PortalHttpError(
          `${course.courseCode}: portal returned no attendance payload`,
          'EMPTY_RESPONSE'
        );
      }

      const total = attRes.totalClasses;
      const present = attRes.presentClasses;
      const absent = Math.max(0, total - present);
      const percentage =
        total > 0
          ? (present / total) * 100
          : attRes.relPresentPercentage
            ? parseFloat(attRes.relPresentPercentage)
            : 100;

      const item: AttendanceItem = {
        courseCode: course.courseCode,
        courseTitle: course.courseTitle,
        instructor: course.instructor,
        present,
        absent,
        totalClasses: total,
        percentage,
        records: attRes.data,
        fetchedAt: Date.now(),
        stale: false,
        srsStatus: course.srsStatus,
      };

      // Progressive delivery: hand each card to the UI as soon as it lands.
      options.onCourse?.(item);
      return item;
    });

    const items: AttendanceItem[] = settled.map((result, index) => {
      const course = courses![index];

      if (result.ok) {
        return result.value;
      }

      failures.push(course.courseCode);
      console.warn(`[HttpPortalClient] Attendance refresh failed for ${course.courseCode}:`, result.error);

      const previousItem = previousByCode.get(course.courseCode);
      if (previousItem) {
        // Keep the last known good numbers; mark them as stale rather than 0.
        // NOTE: progressive delivery is intentionally NOT used here — if the
        // whole refresh turns out to be a failure we throw below and must not
        // have already mutated the UI with a half-applied result.
        return {
          ...previousItem,
          courseTitle: course.courseTitle || previousItem.courseTitle,
          instructor: course.instructor || previousItem.instructor,
          srsStatus: course.srsStatus ?? previousItem.srsStatus,
          stale: true,
        };
      }

      return {
        courseCode: course.courseCode,
        courseTitle: course.courseTitle,
        instructor: course.instructor,
        present: 0,
        absent: 0,
        totalClasses: 0,
        percentage: 0,
        records: [],
        stale: true,
        srsStatus: course.srsStatus,
      };
    });

    const everyCourseFailed = items.length > 0 && failures.length === items.length;

    if (everyCourseFailed) {
      const message =
        'Shiksha did not return attendance for any course. Saved data is being shown instead.';
      if (!options.skipCache) {
        await CacheService.markScopeFailure('ATTENDANCE', 'EMPTY_RESPONSE', message);
      }
      SyncDiagnostics.log({
        kind: 'sync',
        label: 'ATTENDANCE',
        ok: false,
        ms: Date.now() - startedAt,
        detail: `all ${items.length} course requests failed`,
      });
      // Do NOT overwrite good cache with a fully degraded result.
      throw new PortalHttpError(message, 'EMPTY_RESPONSE');
    }

    // Partial success: now it is safe to push the stale (saved) cards to the UI.
    if (failures.length > 0) {
      for (const item of items) {
        if (item.stale) options.onCourse?.(item);
      }
    }

    const data: AttendanceData = {
      items,
      timestamp: new Date().toISOString(),
      degraded: failures.length > 0,
      partialFailures: failures.length > 0 ? failures : undefined,
    };

    if (!options.skipCache) {
      await CacheService.cacheAttendanceData(data);
      await CacheService.markScopeSuccess('ATTENDANCE');
    }

    SyncDiagnostics.log({
      kind: 'sync',
      label: 'ATTENDANCE',
      ok: true,
      ms: Date.now() - startedAt,
      detail: failures.length > 0 ? `${failures.length}/${items.length} courses failed` : undefined,
    });

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
      // Typed so callers can keep showing cached profile data and explain the
      // failure instead of aborting the whole sync.
      throw new PortalHttpError(
        'Could not read your profile from the portal response.',
        'PARSE_ERROR'
      );
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
    const startedAt = Date.now();
    try {
      const profile = await this.getProfile();
      await CacheService.cacheProfileData(profile);
      await CacheService.markScopeSuccess('PROFILE');
      SyncDiagnostics.log({ kind: 'sync', label: 'PROFILE', ok: true, ms: Date.now() - startedAt });
      return profile;
    } catch (err: any) {
      const code: PortalErrorCode = err instanceof PortalHttpError ? err.code : 'UNKNOWN';
      const message = err?.message || 'Profile sync failed.';
      await CacheService.markScopeFailure('PROFILE', code, message);
      SyncDiagnostics.log({
        kind: 'sync',
        label: 'PROFILE',
        ok: false,
        ms: Date.now() - startedAt,
        detail: `${code}: ${message}`,
      });
      throw err;
    }
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

    const courses: Course[] = rawCourses.map((c) => ({
      courseCode: c.courseCode,
      courseTitle: c.courseTitle,
      instructor: c.instructor,
      attendanceArg: c.attendanceArg,
      srsStatus: {
        midSemAvailable: c.srsStatus.midSemAvailable,
        midSemUrl: c.srsStatus.midSemUrl,
        endSemAvailable: c.srsStatus.endSemAvailable,
        endSemUrl: c.srsStatus.endSemUrl,
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
    const startedAt = Date.now();
    try {
      const result = await this.getCourses();

      if (!result.courses || result.courses.length === 0) {
        // Empty parse → almost always a failed/blocked fetch rather than a
        // genuinely empty registration. Preserve whatever we already have.
        const cached = await CacheService.getCachedCoursesData();
        const message = cached && cached.length > 0
          ? 'The portal did not return your course list. Showing saved courses.'
          : 'Could not read your course list from the portal response.';
        await CacheService.markScopeFailure('COURSES', 'EMPTY_RESPONSE', message);
        SyncDiagnostics.log({
          kind: 'sync',
          label: 'COURSES',
          ok: false,
          ms: Date.now() - startedAt,
          detail: message,
        });
        throw new PortalHttpError(message, 'EMPTY_RESPONSE');
      }

      await CacheService.cacheCoursesData(result.courses);
      if (result.courseDetails && Object.keys(result.courseDetails).length > 0) {
        await CacheService.cacheCourseDetails(result.courseDetails);
      }
      await CacheService.markScopeSuccess('COURSES');
      SyncDiagnostics.log({ kind: 'sync', label: 'COURSES', ok: true, ms: Date.now() - startedAt });
      return result;
    } catch (err: any) {
      if (!(err instanceof PortalHttpError)) {
        await CacheService.markScopeFailure('COURSES', 'UNKNOWN', err?.message || 'Courses sync failed.');
        SyncDiagnostics.log({
          kind: 'sync',
          label: 'COURSES',
          ok: false,
          ms: Date.now() - startedAt,
          detail: err?.message || 'Courses sync failed.',
        });
      }
      throw err;
    }
  }

  /**
   * Synchronizes every scope independently.
   *
   * Previously this used `Promise.all([syncProfile(), syncCourses()])`, so a
   * single throwing parser (the profile regex is the flakiest one) aborted the
   * entire sync: no courses, no attendance, no reports, no lastSyncTime — which
   * is exactly the reported "nothing past the login screen loads" behaviour.
   * Failures are now collected per scope, successful scopes still commit, and
   * degraded scopes keep their cache.
   */
  public static async syncAll(): Promise<PortalSyncAllResult> {
    const startedAt = Date.now();
    const errors: PortalSyncError[] = [];

    const collect = (scope: PortalSyncScope, error: unknown) => {
      const code: PortalErrorCode = error instanceof PortalHttpError ? error.code : 'UNKNOWN';
      errors.push({
        scope,
        code,
        message: (error as any)?.message || `${scope} sync failed.`,
      });
    };

    // Profile and the course list are independent → run them together, but
    // settle each one separately.
    const [profileResult, coursesResult] = await Promise.allSettled([
      this.syncProfile(),
      this.syncCourses(),
    ]);

    const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
    if (profileResult.status === 'rejected') collect('PROFILE', profileResult.reason);

    const courses = coursesResult.status === 'fulfilled' ? coursesResult.value.courses : null;
    const courseDetails =
      coursesResult.status === 'fulfilled' ? coursesResult.value.courseDetails : null;
    if (coursesResult.status === 'rejected') collect('COURSES', coursesResult.reason);

    // Attendance depends on the course list; fall back to the cached list so a
    // courses failure never cascades into attendance.
    let attendance: AttendanceData | null = null;
    try {
      attendance = await this.syncAttendance(
        courses && courses.length > 0 ? { courses } : {}
      );
    } catch (error) {
      collect('ATTENDANCE', error);
    }

    let reports: ReportItem[] | null = null;
    try {
      const fetched = await this.getStudentReports();
      if (fetched.length > 0) {
        await CacheService.cacheReportsData(fetched);
      }
      reports = fetched;
      await CacheService.markScopeSuccess('REPORTS');
    } catch (error) {
      collect('REPORTS', error);
      const code: PortalErrorCode = error instanceof PortalHttpError ? error.code : 'UNKNOWN';
      await CacheService.markScopeFailure('REPORTS', code, (error as any)?.message || 'Reports sync failed.');
      reports = null;
    }

    const anySuccess = errors.length < 4;
    if (anySuccess) {
      await CacheService.setLastSyncTime(Date.now());
    }

    SyncDiagnostics.log({
      kind: 'sync',
      label: 'ALL',
      ok: errors.length === 0,
      ms: Date.now() - startedAt,
      detail: errors.length > 0
        ? errors.map((e) => `${e.scope}:${e.code}`).join(', ')
        : 'all scopes ok',
    });

    return { profile, courses, courseDetails, attendance, reports, errors };
  }
}

