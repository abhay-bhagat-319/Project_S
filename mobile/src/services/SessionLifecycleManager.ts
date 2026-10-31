import { SecureStorageService } from './SecureStorageService';
import { ScraperService } from './ScraperService';
import { HttpPortalClient } from './HttpPortalClient';

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
 * Governs authentication and session lifecycle:
 * - Credential verification & portal handshake over direct HTTP
 * - Authenticated server-side session termination (/logout with active cookies)
 * - Complete WebView cookie jar & web storage sanitization on logout
 * - Silent background session recovery
 */
export class SessionLifecycleManager {
  private static adapter: AuthAdapterBridge | null = null;

  private static pendingPurge: {
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  private static isAuthenticating = false;

  /**
   * Registers the Portal WebView adapter so logout can purge WebView cookies and storage.
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
   * Dispatches incoming WebView message events to active session purge operations
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

    return false;
  }

  /**
   * Authenticates user against the Shiksha portal via direct HTTP login
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
        await SecureStorageService.saveCredentials(trimmedUser, trimmedPass);
        return { success: true };
      }

      let code: AuthResult['code'] = 'AUTH_FAILED';
      if (result.code === 'TIMEOUT') {
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
   * 1. Issues authenticated server-side logout request to https://shiksha.iiserb.ac.in/logout
   *    BEFORE clearing local cookies so the server invalidates the active session.
   * 2. Clears in-memory HTTP session cookie.
   * 3. Injects script into the Portal WebView to wipe cookies, localStorage, and sessionStorage.
   */
  public static async purgeSession(timeoutMs = 4000): Promise<void> {
    // 1. Server-side logout WITH active session cookies included
    try {
      await HttpPortalClient.get('/logout', {
        timeoutMs: 2500,
        skipSessionCheck: true,
        skipQueue: true,
      });
    } catch {
      // Non-blocking if user is offline during logout
    }

    // 2. Clear active HTTP client session cookie in memory
    HttpPortalClient.clearSession();

    // 3. In-WebView client-side cookie & web storage wipe
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

      this.adapter.loadUrl('https://shiksha.iiserb.ac.in/login/');
    }
  }

  /**
   * Silently attempts to re-authenticate an expired session in the background
   */
  public static async silentReauthenticate(): Promise<boolean> {
    return HttpPortalClient.recoverSession();
  }

  public static isAuthInProgress(): boolean {
    return this.isAuthenticating;
  }
}
