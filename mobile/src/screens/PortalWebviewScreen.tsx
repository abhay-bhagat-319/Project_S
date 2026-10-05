import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { ScraperService } from '../services/ScraperService';
import { ReportsService } from '../services/ReportsService';

export interface PortalWebviewHandle {
  handleBackPress: () => boolean;
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

const PortalWebviewScreen = forwardRef<PortalWebviewHandle, PortalWebviewScreenProps>(function PortalWebviewScreen({
  credentials,
  targetUrl,
  onClearTargetUrl,
}, ref) {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [initialSource] = useState({ uri: targetUrl || DEFAULT_URL });
  const [currentUrl, setCurrentUrl] = useState<string>(targetUrl || DEFAULT_URL);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Register WebView as the authenticated PDF downloader bridge
  useEffect(() => {
    const unregister = ReportsService.registerPdfDownloader((fileUrl, reportId) => {
      const pendingPromise = ReportsService.createPendingPdfDownload(reportId);
      const script = ScraperService.getPdfDownloadScript(fileUrl, reportId);
      webViewRef.current?.injectJavaScript(script);
      return pendingPromise;
    });
    return unregister;
  }, []);

  useEffect(() => {
    if (targetUrl && targetUrl !== currentUrl) {
      setCurrentUrl(targetUrl);
      webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(targetUrl)}; true;`);
      if (onClearTargetUrl) {
        onClearTargetUrl();
      }
    }
  }, [targetUrl]);

  const handleNavigationStateChange = (navState: any) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    setLoading(navState.loading);
    if (navState.url) {
      setCurrentUrl(navState.url);
      // Auto-login injection if redirected to /login
      if (navState.url.includes('/login') && credentials) {
        webViewRef.current?.injectJavaScript(
          ScraperService.getLoginInjectionScript(credentials.username, credentials.password)
        );
      }
    }
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (ReportsService.handlePdfMessage(data)) {
        return;
      }
      if (data.type === 'LOGIN_SUBMITTED') {
        console.log('PortalWebview: Auto-login submitted successfully.');
      }
    } catch (e) {}
  };

  const handleLoadEnd = () => {
    setLoading(false);
    setProgress(1);
    if (currentUrl && currentUrl.includes('/login') && credentials) {
      webViewRef.current?.injectJavaScript(
        ScraperService.getLoginInjectionScript(credentials.username, credentials.password)
      );
    }
    // Inject desktop viewport and clean font smoothing
    webViewRef.current?.injectJavaScript(ScraperService.getDesktopViewportScript());
  };

  const goBack = () => {
    if (canGoBack) {
      // First try history back in JS context which bypasses synthetic redirect loops, fallback to native goBack
      webViewRef.current?.injectJavaScript(`
        if (window.history.length > 1) {
          window.history.back();
        }
        true;
      `);
      webViewRef.current?.goBack();
    }
  };

  const goForward = () => {
    if (canGoForward) {
      webViewRef.current?.injectJavaScript(`
        window.history.forward();
        true;
      `);
      webViewRef.current?.goForward();
    }
  };

  const reload = () => {
    webViewRef.current?.reload();
  };

  const goHome = () => {
    webViewRef.current?.injectJavaScript(`window.location.href = "${DEFAULT_URL}"; true;`);
  };

  useImperativeHandle(ref, () => ({
    handleBackPress: () => {
      if (canGoBack) {
        goBack();
        return true;
      }
      return false;
    },
  }), [canGoBack]);

  return (
    <View style={styles.container}>
      {/* Top Browser Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.navBtn, !canGoBack && styles.disabledBtn]}
            onPress={goBack}
            disabled={!canGoBack}
            activeOpacity={0.7}
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={canGoBack ? Theme.colors.textPrimary : Theme.colors.textSecondary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navBtn, !canGoForward && styles.disabledBtn]}
            onPress={goForward}
            disabled={!canGoForward}
            activeOpacity={0.7}
          >
            <Ionicons
              name="chevron-forward"
              size={20}
              color={canGoForward ? Theme.colors.textPrimary : Theme.colors.textSecondary}
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
              {currentUrl.replace('https://', '')}
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

      {/* Embedded Desktop Class Web View */}
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
          thirdPartyCookiesEnabled={true}
          originWhitelist={['*']}
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
          injectedJavaScript={ScraperService.getDesktopViewportScript()}
          userAgent={DESKTOP_USER_AGENT}
          style={styles.webview}
        />
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
});

export default PortalWebviewScreen;
