import { SecureStorageService } from './SecureStorageService';
import { ScraperService } from './ScraperService';

export interface AuthResult {
  success: boolean;
  message?: string;
  code?: 'AUTH_FAILED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'UNKNOWN';
}

export interface AuthAdapterBridge {
  loadUrl: (url: string) => void;
  injectScript: (script: string) => void;
  reload: () => void;
}

/**
 * Deep module governing the authentication and session lifecycle:
 * - Credential verification & portal handshake
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
   * Registers the active native WebView adapter hosted at the root of the app
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
    if (url.includes('/login') && this.pendingAuth && this.adapter) {
      const script = ScraperService.getLoginInjectionScript(
        this.pendingAuth.username,
        this.pendingAuth.password
      );
      this.adapter.injectScript(script);
    }
  }

  /**
   * Executes when the auth adapter finishes loading a page
   */
  public static handleLoadEnd(currentUrl: string) {
    if (!currentUrl) return;

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
   * Authenticates user against the Shiksha portal with timeout safety guard
   */
  public static authenticate(username: string, password: string, timeoutMs = 25000): Promise<AuthResult> {
    const trimmedUser = username.trim();
    const trimmedPass = password.trim();

    if (!trimmedUser || !trimmedPass) {
      return Promise.resolve({
        success: false,
        code: 'AUTH_FAILED',
        message: 'Please enter both username and password.',
      });
    }

    if (!this.adapter) {
      return Promise.resolve({
        success: false,
        code: 'NETWORK_ERROR',
        message: 'Authentication engine is initializing. Please try again.',
      });
    }

    if (this.pendingAuth) {
      clearTimeout(this.pendingAuth.timer);
      this.pendingAuth.resolve({
        success: false,
        code: 'UNKNOWN',
        message: 'Superceded by a new login attempt.',
      });
      this.pendingAuth = null;
    }

    this.isAuthenticating = true;

    return new Promise<AuthResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingAuth) {
          this.pendingAuth = null;
          this.isAuthenticating = false;
          resolve({
            success: false,
            code: 'TIMEOUT',
            message: 'Portal verification took too long. Please verify your internet connection or LDAP credentials.',
          });
        }
      }, timeoutMs);

      this.pendingAuth = {
        username: trimmedUser,
        password: trimmedPass,
        resolve,
        timer,
      };

      // Navigate to login URL to begin handshake
      this.adapter?.loadUrl('https://shiksha.iiserb.ac.in/login/');
    });
  }

  /**
   * Dual-phase session purge:
   * 1. Issues server-side logout request to https://shiksha.iiserb.ac.in/logout
   * 2. Injects script to wipe cookies, localStorage, and sessionStorage
   * 3. Resets adapter to a pristine state
   */
  public static async purgeSession(timeoutMs = 4000): Promise<void> {
    console.log('[SessionLifecycleManager] Starting complete session purge...');

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
