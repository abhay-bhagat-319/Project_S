import { SecureStorageService } from './SecureStorageService';
import { ScraperService } from './ScraperService';
import { NetworkReachabilityService } from './NetworkReachabilityService';
import { HttpPortalClient } from './HttpPortalClient';

export interface AuthResult {
  success: boolean;
  message?: string;
  code?: 'AUTH_FAILED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'CAMPUS_NETWORK_REQUIRED' | 'UNKNOWN';
}

export interface AuthAdapterBridge {
  loadUrl: (url: string) => void;
  injectScript: (script: string) => void;
  reload: () => void;
}

/**
 * Deep module governing the authentication and session lifecycle:
 * - Credential verification & portal handshake over direct HTTP (in ~200ms)
 * - Complete cookie jar & web storage sanitization on logout
 * - Server-side session invalidation
 * - Silent background session recovery
 */
export class SessionLifecycleManager {
  private static adapter: AuthAdapterBridge | null = null;
  private static pendingAuth: {
    username: string;
    password: string;
    resolve: (res: AuthResult) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  private static pendingPurge: {
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  private static isAuthenticating = false;

  /**
   * Registers the active native WebView adapter hosted at the root of the app.
   * @deprecated Background WebViews are being retired in favor of direct HTTP.
   */
  public static registerAdapter(adapter: AuthAdapterBridge): () => void {
    this.adapter = adapter;
    return () => {
      if (this.adapter === adapter) {
        this.adapter = null;
      }
    };
  }

  /**
   * Dispatches incoming WebView message events to active auth or purge operations
   */
  public static handleWebViewMessage(data: { type: string; message?: string }): boolean {
    if (!data || !data.type) return false;

    if (data.type === 'SESSION_PURGED') {
      if (this.pendingPurge) {
        clearTimeout(this.pendingPurge.timer);
        const { resolve } = this.pendingPurge;
        this.pendingPurge = null;
        resolve();
        return true;
      }
    }

    if (data.type === 'AUTH_FAILED') {
      if (this.pendingAuth) {
        clearTimeout(this.pendingAuth.timer);
        const { resolve } = this.pendingAuth;
        this.pendingAuth = null;
        this.isAuthenticating = false;
        resolve({
          success: false,
          code: 'AUTH_FAILED',
          message: data.message || 'Invalid LDAP credentials. Please check your username and password.',
        });
        return true;
      }
    }

    if (data.type === 'AUTH_SUCCESS') {
      NetworkReachabilityService.recordSuccess();
      if (this.pendingAuth) {
        clearTimeout(this.pendingAuth.timer);
        const { resolve, username, password } = this.pendingAuth;
        this.pendingAuth = null;
        this.isAuthenticating = false;
        SecureStorageService.saveCredentials(username, password).catch(() => {});
        resolve({ success: true });
        return true;
      }
    }

    return false;
  }

  /**
   * Handles navigation state transitions in the authentication adapter
   */
  public static handleNavigationStateChange(url: string) {
    if (!url) return;
    console.log('[SessionLifecycleManager] URL changed:', url);

    // If navigated to secure area, authentication was successful
    if (url.includes('/secure/') || url.includes('/secure')) {
      NetworkReachabilityService.recordSuccess();
      if (this.pendingAuth) {
        clearTimeout(this.pendingAuth.timer);
        const { resolve, username, password } = this.pendingAuth;
        this.pendingAuth = null;
        this.isAuthenticating = false;
        SecureStorageService.saveCredentials(username, password).catch(() => {});
        resolve({ success: true });
      }
      return;
    }

    // If on ldap_login_progress, do not interfere — let portal progress to /secure
    if (url.includes('ldap_login_progress') || url.includes('login_progress')) {
      return;
    }

    // If on login page and an authentication attempt is active, inject the login script
    if (url.includes('/login')) {
      NetworkReachabilityService.recordSuccess();
      if (this.pendingAuth && this.adapter) {
        const script = ScraperService.getLoginInjectionScript(
          this.pendingAuth.username,
          this.pendingAuth.password
        );
        this.adapter.injectScript(script);
      }
    }
  }

  /**
   * Executes when the auth adapter finishes loading a page
   */
  public static handleLoadEnd(currentUrl: string) {
    if (!currentUrl) return;

    if (currentUrl.includes('/login') || currentUrl.includes('/secure')) {
      NetworkReachabilityService.recordSuccess();
    }

    if (this.pendingAuth && this.adapter) {
      if (currentUrl.includes('/secure')) {
        this.handleNavigationStateChange(currentUrl);
      } else if (currentUrl.includes('ldap_login_progress') || currentUrl.includes('login_progress')) {
        // Wait for portal to complete LDAP check and redirect
        return;
      } else if (currentUrl.includes('/login')) {
        const script = ScraperService.getLoginInjectionScript(
          this.pendingAuth.username,
          this.pendingAuth.password
        );
        this.adapter.injectScript(script);
      }
    }
  }

  /**
   * Handles native WebView load errors during authentication
   */
  public static async handleAuthError(errorMsg?: string): Promise<void> {
    if (this.pendingAuth) {
      clearTimeout(this.pendingAuth.timer);
      const { resolve } = this.pendingAuth;
      this.pendingAuth = null;
      this.isAuthenticating = false;

      const netState = await NetworkReachabilityService.recordFailure(errorMsg);
      if (netState === 'EXTERNAL_ONLINE') {
        resolve({
          success: false,
          code: 'CAMPUS_NETWORK_REQUIRED',
          message: 'Campus network required. Please connect to IISERB Wi-Fi or turn on FortiClient VPN (gateway.iiserb.ac.in).',
        });
      } else if (netState === 'OFFLINE') {
        resolve({
          success: false,
          code: 'NETWORK_ERROR',
          message: 'No internet connection detected. Please check your network connection.',
        });
      } else {
        resolve({
          success: false,
          code: 'NETWORK_ERROR',
          message: errorMsg || 'Unable to connect to Shiksha portal. Please check your connection and try again.',
        });
      }
    }
  }

  /**
   * Authenticates user against the Shiksha portal via direct HTTP login in ~200ms
   */
  public static async authenticate(username: string, password: string, timeoutMs = 15000): Promise<AuthResult> {
    const trimmedUser = username.trim();
    const trimmedPass = password.trim();

    if (!trimmedUser || !trimmedPass) {
      return {
        success: false,
        code: 'AUTH_FAILED',
        message: 'Please enter both username and password.',
      };
    }

    this.isAuthenticating = true;

    try {
      const result = await HttpPortalClient.login(trimmedUser, trimmedPass, timeoutMs);

      if (result.success) {
        NetworkReachabilityService.recordSuccess();
        await SecureStorageService.saveCredentials(trimmedUser, trimmedPass);
        return { success: true };
      }

      let code: AuthResult['code'] = 'AUTH_FAILED';
      if (result.code === 'CAMPUS_NETWORK_REQUIRED') {
        code = 'CAMPUS_NETWORK_REQUIRED';
      } else if (result.code === 'TIMEOUT') {
        code = 'TIMEOUT';
      } else if (result.code === 'NETWORK_ERROR') {
        code = 'NETWORK_ERROR';
      }

      return {
        success: false,
        code,
        message: result.message || 'Invalid LDAP credentials. Please check your username and password.',
      };
    } catch (err: any) {
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: err.message || 'Unable to authenticate with Shiksha portal.',
      };
    } finally {
      this.isAuthenticating = false;
    }
  }

  /**
   * Dual-phase session purge:
   * 1. Issues server-side logout request to https://shiksha.iiserb.ac.in/logout
   * 2. Injects script to wipe cookies, localStorage, and sessionStorage
   * 3. Resets adapter to a pristine state
   */
  public static async purgeSession(timeoutMs = 4000): Promise<void> {
    console.log('[SessionLifecycleManager] Starting complete session purge...');

    // Clear active HTTP client session
    HttpPortalClient.clearSession();

    // 1. Fire-and-forget server-side logout beacon
    try {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 2500);
      await fetch('https://shiksha.iiserb.ac.in/logout', {
        method: 'GET',
        signal: controller.signal,
        credentials: 'omit',
      }).catch(() => {});
      clearTimeout(abortTimer);
    } catch {
      // Non-blocking
    }

    // 2. In-WebView client-side cookie & web storage wipe
    if (this.adapter) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.pendingPurge = null;
          resolve();
        }, timeoutMs);

        this.pendingPurge = { resolve, timer };

        const purgeScript = ScraperService.getSessionPurgeScript();
        this.adapter?.injectScript(purgeScript);
      });

      // Load blank or login URL to reset adapter context
      this.adapter.loadUrl('https://shiksha.iiserb.ac.in/login/');
    }

    console.log('[SessionLifecycleManager] Session purge complete.');
  }

  /**
   * Silently attempts to re-authenticate an expired session in the background
   */
  public static async silentReauthenticate(): Promise<boolean> {
    try {
      const creds = await SecureStorageService.getCredentials();
      if (!creds || !creds.username || !creds.password) {
        return false;
      }
      const res = await this.authenticate(creds.username, creds.password, 15000);
      return res.success;
    } catch {
      return false;
    }
  }

  public static isAuthInProgress(): boolean {
    return this.isAuthenticating;
  }
}
