import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { ScraperService } from '../services/ScraperService';
import { ReportsService } from '../services/ReportsService';
import { SessionLifecycleManager } from '../services/SessionLifecycleManager';

export interface PortalWebviewHandle {
  handleBackPress: () => boolean;
  injectJavaScript?: (script: string) => void;
}

export interface PortalWebviewScreenProps {
  credentials: { username: string; password: string } | null;
  targetUrl?: string | null;
  onClearTargetUrl?: () => void;
}

const DEFAULT_URL = 'https://shiksha.iiserb.ac.in/secure/studenthome';

// Desktop User Agent to guarantee standard desktop layout and data tables from Shiksha portal
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * Validates that a URL is an HTTPS or HTTP URL belonging to *.iiserb.ac.in or a relative path
 */
function isAllowedIiserbUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  if (rawUrl.startsWith('/') || rawUrl.startsWith('./')) return true;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'iiserb.ac.in' || host.endsWith('.iiserb.ac.in');
  } catch {
    return false;
  }
}

/**
 * Validates that a URL specifically belongs to the Shiksha portal (https://shiksha.iiserb.ac.in) or is a relative portal path
 */
function isShikshaOrigin(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  if (rawUrl.startsWith('/') || rawUrl.startsWith('./')) return true;
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.hostname.toLowerCase() === 'shiksha.iiserb.ac.in'
    );
  } catch {
    return false;
  }
}

const PortalWebviewScreen = forwardRef<PortalWebviewHandle, PortalWebviewScreenProps>(function PortalWebviewScreen({
  credentials,
  targetUrl,
  onClearTargetUrl,
}, ref) {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const initialUri = targetUrl && isAllowedIiserbUrl(targetUrl) ? targetUrl : DEFAULT_URL;
  const [initialSource] = useState({ uri: initialUri });
  const [currentUrl, setCurrentUrl] = useState<string>(initialUri);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isCampusError, setIsCampusError] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Register WebView with SessionLifecycleManager (for logout cookie purge) and ReportsService
  useEffect(() => {
    const unregisterAdapter = SessionLifecycleManager.registerAdapter({
      loadUrl: (url: string) => {
        if (isAllowedIiserbUrl(url)) {
          webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
        }
      },
      injectScript: (script: string) => {
        webViewRef.current?.injectJavaScript(script);
      },
      reload: () => {
        webViewRef.current?.reload();
      },
    });

    const unregisterPdf = ReportsService.registerPdfDownloader((fileUrl, reportId) => {
      if (!isAllowedIiserbUrl(fileUrl)) {
        return Promise.reject(new Error('Refusing to download report from untrusted origin.'));
      }
      const pendingPromise = ReportsService.createPendingPdfDownload(reportId);
      const script = ScraperService.getPdfDownloadScript(fileUrl, reportId);
      webViewRef.current?.injectJavaScript(script);
      return pendingPromise;
    });

    return () => {
      unregisterAdapter();
      unregisterPdf();
    };
  }, []);

  useEffect(() => {
    if (targetUrl && targetUrl !== currentUrl) {
      if (isAllowedIiserbUrl(targetUrl)) {
        setCurrentUrl(targetUrl);
        setIsCampusError(false);
        webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(targetUrl)}; true;`);
      }
      if (onClearTargetUrl) {
        onClearTargetUrl();
      }
    }
  }, [targetUrl]);

  const isReauthenticatingRef = useRef(false);

  const handleNavigationStateChange = async (navState: any) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    setLoading(navState.loading);
    if (navState.url) {
      setCurrentUrl(navState.url);
      // Only trigger silent re-authentication when on the official shiksha.iiserb.ac.in origin
      if (
        isShikshaOrigin(navState.url) &&
        navState.url.includes('/login') &&
        !isReauthenticatingRef.current
      ) {
        isReauthenticatingRef.current = true;
        try {
          const recovered = await SessionLifecycleManager.silentReauthenticate();
          if (recovered) {
            webViewRef.current?.reload();
          }
        } finally {
          setTimeout(() => {
            isReauthenticatingRef.current = false;
          }, 4000);
        }
      }
    }
  };

  const handleShouldStartLoadWithRequest = (request: any): boolean => {
    const reqUrl = request?.url || '';
    if (reqUrl === 'about:blank') return true;

    if (isAllowedIiserbUrl(reqUrl)) {
      return true;
    }

    // Open external non-iiserb links safely in the system browser instead of inside the authenticated WebView
    if (reqUrl.startsWith('https://') || reqUrl.startsWith('http://')) {
      Linking.openURL(reqUrl).catch(() => {});
    }
    return false;
  };

  const handleMessage = (event: any) => {
    try {
      const originUrl = event?.nativeEvent?.url || currentUrl;
      if (!isAllowedIiserbUrl(originUrl)) {
        return;
      }
      const data = JSON.parse(event.nativeEvent.data);
      if (SessionLifecycleManager.handleWebViewMessage(data)) {
        return;
      }
      if (ReportsService.handlePdfMessage(data)) {
        return;
      }
    } catch {}
  };

  const handleLoadEnd = () => {
    setLoading(false);
    setProgress(1);
    setIsCampusError(false);
    if (isAllowedIiserbUrl(currentUrl)) {
      webViewRef.current?.injectJavaScript(ScraperService.getDesktopViewportScript());
    }
  };

  const handleError = (syntheticEvent?: any) => {
    const code = syntheticEvent?.nativeEvent?.code;
    // Ignore canceled/aborted loads (-999 on iOS, -1 on Android)
    if (code === -999 || code === -1) {
      return;
    }
    setLoading(false);
    setIsCampusError(true);
  };

  const handleHttpError = (syntheticEvent: any) => {
    const { statusCode } = syntheticEvent?.nativeEvent || {};
    // Only flag 5xx server errors as campus errors, do not fail entire view for 4xx subresources
    if (statusCode && statusCode >= 500) {
      handleError(syntheticEvent);
    }
  };

  const handleRetry = () => {
    setIsCampusError(false);
    setLoading(true);
    try {
      webViewRef.current?.reload();
    } catch {}
  };

  const goBack = () => {
    if (canGoBack && !isCampusError) {
      try {
        webViewRef.current?.injectJavaScript(`
          if (window.history.length > 1) {
            window.history.back();
          }
          true;
        `);
        webViewRef.current?.goBack();
      } catch {}
    }
  };

  const goForward = () => {
    if (canGoForward && !isCampusError) {
      try {
        webViewRef.current?.injectJavaScript(`
          window.history.forward();
          true;
        `);
        webViewRef.current?.goForward();
      } catch {}
    }
  };

  const reload = () => {
    setIsCampusError(false);
    try {
      webViewRef.current?.reload();
    } catch {}
  };

  const goHome = () => {
    setIsCampusError(false);
    setCurrentUrl(DEFAULT_URL);
    try {
      if (isCampusError) {
        webViewRef.current?.reload();
      } else {
        webViewRef.current?.injectJavaScript(`window.location.href = "${DEFAULT_URL}"; true;`);
      }
    } catch (e) {
      console.warn('goHome navigation error:', e);
      try {
        webViewRef.current?.reload();
      } catch {}
    }
  };

  useImperativeHandle(ref, () => ({
    handleBackPress: () => {
      if (canGoBack && !isCampusError) {
        goBack();
        return true;
      }
      return false;
    },
    injectJavaScript: (script: string) => {
      webViewRef.current?.injectJavaScript(script);
    },
  }), [canGoBack, isCampusError]);

  return (
    <View style={styles.container}>
      {/* Top Browser Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.navBtn, (!canGoBack || isCampusError) && styles.disabledBtn]}
            onPress={goBack}
            disabled={!canGoBack || isCampusError}
            activeOpacity={0.7}
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={canGoBack && !isCampusError ? Theme.colors.textPrimary : Theme.colors.textSecondary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navBtn, (!canGoForward || isCampusError) && styles.disabledBtn]}
            onPress={goForward}
            disabled={!canGoForward || isCampusError}
            activeOpacity={0.7}
          >
            <Ionicons
              name="chevron-forward"
              size={20}
              color={canGoForward && !isCampusError ? Theme.colors.textPrimary : Theme.colors.textSecondary}
            />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navBtn} onPress={reload} activeOpacity={0.7}>
            <Ionicons name="refresh" size={18} color={Theme.colors.textPrimary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navBtn} onPress={goHome} activeOpacity={0.7}>
            <Ionicons name="home" size={18} color={Theme.colors.primary} />
          </TouchableOpacity>

          {/* Clean URL Display Pill */}
          <View style={styles.urlIndicator}>
            <Ionicons name="globe-outline" size={13} color={Theme.colors.primary} style={{ marginRight: 5 }} />
            <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="tail">
              {currentUrl.replace('https://', '').replace('http://', '')}
            </Text>
          </View>
        </View>

        {/* Loading Progress Bar */}
        {loading && progress < 1 && (
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${Math.max(15, progress * 100)}%` }]} />
          </View>
        )}
      </View>

      {/* Embedded Desktop Class Web View or Campus Shield Fallback */}
      <View 
        style={[
          styles.webviewContainer, 
          { marginBottom: Theme.layout.navBarHeight + Math.max(16, insets.bottom + Theme.layout.navBarBaseBottom) + 8 }
        ]}
      >
        <WebView
          ref={webViewRef}
          source={initialSource}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={false}
          allowFileAccess={false}
          originWhitelist={['https://*.iiserb.ac.in', 'https://iiserb.ac.in', 'http://*.iiserb.ac.in', 'http://iiserb.ac.in']}
          onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          scalesPageToFit={true}
          setBuiltInZoomControls={true}
          setDisplayZoomControls={false}
          textZoom={100}
          showsHorizontalScrollIndicator={true}
          showsVerticalScrollIndicator={true}
          allowsInlineMediaPlayback={true}
          onMessage={handleMessage}
          onNavigationStateChange={handleNavigationStateChange}
          onLoadStart={() => {
            setLoading(true);
            setProgress(0.1);
          }}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onLoadEnd={handleLoadEnd}
          onError={handleError}
          onHttpError={handleHttpError}
          onRenderProcessGone={() => {
            setIsCampusError(true);
            return true;
          }}
          injectedJavaScript={ScraperService.getDesktopViewportScript()}
          userAgent={DESKTOP_USER_AGENT}
          style={[styles.webview, isCampusError && { opacity: 0 }]}
        />

        {isCampusError && (
          <View style={[styles.fallbackContainer, StyleSheet.absoluteFill, { backgroundColor: Theme.colors.background }]}>
            <View style={styles.fallbackShieldIcon}>
              <Ionicons name="cloud-offline-outline" size={44} color="#f59e0b" />
            </View>
            <Text style={styles.fallbackTitle}>Unable to Reach Shiksha</Text>
            <Text style={styles.fallbackSubtitle}>
              Please verify your connection to campus Wi-Fi or VPN, then tap retry.
            </Text>

            <View style={styles.fallbackActions}>
              <TouchableOpacity 
                style={styles.primaryActionBtn} 
                onPress={handleRetry}
                disabled={isRetrying}
                activeOpacity={0.7}
              >
                {isRetrying ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="refresh" size={18} color="#ffffff" style={{ marginRight: 8 }} />
                    <Text style={styles.primaryActionBtnText}>Retry Connection</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  toolbar: {
    backgroundColor: Theme.colors.surface,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  disabledBtn: {
    opacity: 0.35,
  },
  urlIndicator: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: Theme.radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginLeft: 2,
  },
  urlText: {
    flex: 1,
    fontSize: 11,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  progressBarTrack: {
    height: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    width: '100%',
    marginTop: 6,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Theme.colors.primary,
  },
  webviewContainer: {
    flex: 1,
    marginBottom: 88, // Space for bottom floating navigation bar
  },
  webview: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  fallbackContainer: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.padding,
  },
  fallbackShieldIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  fallbackTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  fallbackSubtitle: {
    fontSize: 13,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  fallbackActions: {
    width: '100%',
    maxWidth: 340,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284c7',
    height: 48,
    borderRadius: Theme.radii.pill,
    marginBottom: 12,
  },
  primaryActionBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 'bold',
  },
});

export default PortalWebviewScreen;
