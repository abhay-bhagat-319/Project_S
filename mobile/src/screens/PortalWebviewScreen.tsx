import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Linking, ScrollView, Alert } from 'react-native';
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

const QUICK_JUMP_LINKS = [
  { label: 'Home', icon: 'home-outline' as const, url: 'https://shiksha.iiserb.ac.in/secure/studenthome' },
  { label: 'My Courses', icon: 'book-outline' as const, url: 'https://shiksha.iiserb.ac.in/secure/studentMyCourses' },
  { label: 'Dues & Fees', icon: 'card-outline' as const, url: 'https://shiksha.iiserb.ac.in/secure/studentdues' },
  { label: 'Reports', icon: 'document-text-outline' as const, url: 'https://shiksha.iiserb.ac.in/secure/studentReports' },
  { label: 'Thesis', icon: 'school-outline' as const, url: 'https://shiksha.iiserb.ac.in/secure/studentthesis' },
];

const PortalWebviewScreen = forwardRef<PortalWebviewHandle, PortalWebviewScreenProps>(function PortalWebviewScreen({
  credentials,
  targetUrl,
  onClearTargetUrl,
}, ref) {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
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
      webViewRef.current?.goBack();
    }
  };

  const goForward = () => {
    if (canGoForward) {
      webViewRef.current?.goForward();
    }
  };

  const reload = () => {
    webViewRef.current?.reload();
  };

  const goHome = () => {
    webViewRef.current?.injectJavaScript(`window.location.href = "${DEFAULT_URL}"; true;`);
  };

  const navigateTo = (url: string) => {
    setCurrentUrl(url);
    webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
  };

  const handleOpenExternal = async () => {
    try {
      const canOpen = await Linking.canOpenURL(currentUrl);
      if (canOpen) {
        await Linking.openURL(currentUrl);
      } else {
        Alert.alert('Unable to Open', 'Could not open URL in external browser.');
      }
    } catch {
      Alert.alert('Browser Notice', 'Could not launch default web browser.');
    }
  };

  const handleResetZoom = () => {
    webViewRef.current?.injectJavaScript(ScraperService.getDesktopViewportScript());
  };

  useImperativeHandle(ref, () => ({
    handleBackPress: () => {
      if (canGoBack) {
        webViewRef.current?.goBack();
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

          {/* URL Display Pill */}
          <View style={styles.urlIndicator}>
            <Ionicons name="desktop-outline" size={13} color={Theme.colors.primary} style={{ marginRight: 4 }} />
            <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="tail">
              {currentUrl.replace('https://', '')}
            </Text>
          </View>

          {/* Reset Zoom / Fit to Screen */}
          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={handleResetZoom} 
            activeOpacity={0.7}
            accessibilityLabel="Fit / Reset Zoom"
          >
            <Ionicons name="scan-outline" size={17} color={Theme.colors.textPrimary} />
          </TouchableOpacity>

          {/* Open in External Browser */}
          <TouchableOpacity 
            style={[styles.navBtn, { marginRight: 0 }]} 
            onPress={handleOpenExternal} 
            activeOpacity={0.7}
            accessibilityLabel="Open in External Browser"
          >
            <Ionicons name="open-outline" size={17} color={Theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Quick Jump Shortcuts Bar */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={styles.quickJumpContent}
          style={styles.quickJumpRow}
        >
          {QUICK_JUMP_LINKS.map((link) => {
            const isActive = currentUrl.includes(link.url);
            return (
              <TouchableOpacity
                key={link.label}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => navigateTo(link.url)}
                activeOpacity={0.75}
              >
                <Ionicons 
                  name={link.icon} 
                  size={13} 
                  color={isActive ? Theme.colors.textDark : Theme.colors.textSecondary} 
                  style={{ marginRight: 5 }} 
                />
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {link.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

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
          source={{ uri: currentUrl }}
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
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
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
    paddingVertical: 6,
    marginLeft: 2,
    marginRight: 6,
  },
  urlText: {
    flex: 1,
    fontSize: 11,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  quickJumpRow: {
    marginTop: 2,
    marginBottom: 4,
  },
  quickJumpContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  chipActive: {
    backgroundColor: Theme.colors.primary,
    borderColor: Theme.colors.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
  },
  chipTextActive: {
    color: Theme.colors.textDark,
  },
  progressBarTrack: {
    height: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    width: '100%',
    marginTop: 4,
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
