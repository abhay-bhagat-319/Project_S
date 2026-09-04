import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Platform, Animated } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { ScraperService } from '../services/ScraperService';

interface PortalWebviewScreenProps {
  credentials: { username: string; password: string } | null;
  targetUrl?: string | null;
  onClearTargetUrl?: () => void;
}

const DEFAULT_URL = 'https://shiksha.iiserb.ac.in/secure/studenthome';

// Mobile User Agent to guarantee mobile responsiveness from server
const MOBILE_USER_AGENT = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  default: 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
});

export default function PortalWebviewScreen({
  credentials,
  targetUrl,
  onClearTargetUrl,
}: PortalWebviewScreenProps) {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState<string>(targetUrl || DEFAULT_URL);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pageTitle, setPageTitle] = useState('Shiksha Portal');

  useEffect(() => {
    if (targetUrl && targetUrl !== currentUrl) {
      setCurrentUrl(targetUrl);
      if (onClearTargetUrl) {
        onClearTargetUrl();
      }
    }
  }, [targetUrl]);

  const handleNavigationStateChange = (navState: any) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    setLoading(navState.loading);
    if (navState.title) {
      setPageTitle(navState.title);
    }
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

  const handleLoadEnd = () => {
    setLoading(false);
    setProgress(1);
    // Inject mobile-responsive CSS and viewport enforcement
    webViewRef.current?.injectJavaScript(ScraperService.getCssInjectionScript());
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

  const optimizeView = () => {
    // Re-trigger layout optimization and viewport reset
    webViewRef.current?.injectJavaScript(ScraperService.getCssInjectionScript());
  };

  return (
    <View style={styles.container}>
      {/* Top Browser Navigation Bar */}
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
            <Ionicons name="home-outline" size={18} color={Theme.colors.primary} />
          </TouchableOpacity>

          <View style={styles.urlIndicator}>
            <Ionicons name="lock-closed" size={12} color={Theme.colors.success} style={{ marginRight: 4 }} />
            <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="tail">
              {currentUrl.replace('https://', '')}
            </Text>
          </View>

          <TouchableOpacity 
            style={[styles.navBtn, { marginRight: 0 }]} 
            onPress={optimizeView} 
            activeOpacity={0.7}
            accessibilityLabel="Optimize View"
          >
            <Ionicons name="phone-portrait-outline" size={16} color={Theme.colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Loading Progress Bar */}
        {loading && progress < 1 && (
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${Math.max(15, progress * 100)}%` }]} />
          </View>
        )}
      </View>

      {/* Embedded Mobile Responsive Web View */}
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
          scalesPageToFit={false}
          setBuiltInZoomControls={true}
          setDisplayZoomControls={false}
          textZoom={100}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={true}
          allowsInlineMediaPlayback={true}
          onNavigationStateChange={handleNavigationStateChange}
          onLoadStart={() => {
            setLoading(true);
            setProgress(0.1);
          }}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onLoadEnd={handleLoadEnd}
          injectedJavaScriptBeforeContentLoaded={ScraperService.getEarlyMobileResponsiveScript()}
          injectedJavaScript={ScraperService.getCssInjectionScript()}
          userAgent={MOBILE_USER_AGENT}
          style={styles.webview}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  toolbar: {
    backgroundColor: Theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    paddingVertical: 6,
    marginLeft: 4,
    marginRight: 6,
  },
  urlText: {
    flex: 1,
    fontSize: 11,
    color: Theme.colors.textSecondary,
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
    backgroundColor: Theme.colors.background,
  },
});
