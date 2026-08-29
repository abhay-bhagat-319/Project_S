import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';
import { ScraperService } from '../services/ScraperService';

interface PortalWebviewScreenProps {
  credentials: { username: string; password: string } | null;
  targetUrl?: string | null;
  onClearTargetUrl?: () => void;
}

const DEFAULT_URL = 'https://shiksha.iiserb.ac.in/secure/studenthome';

export default function PortalWebviewScreen({
  credentials,
  targetUrl,
  onClearTargetUrl,
}: PortalWebviewScreenProps) {
  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState<string>(targetUrl || DEFAULT_URL);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);
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
    // Inject mobile-responsive CSS cleanup
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

          {loading && (
            <View style={styles.spinnerWrapper}>
              <ActivityIndicator size="small" color={Theme.colors.primary} />
            </View>
          )}
        </View>
      </View>

      {/* Embedded Web View */}
      <View style={styles.webviewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: currentUrl }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          onNavigationStateChange={handleNavigationStateChange}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={handleLoadEnd}
          injectedJavaScriptBeforeContentLoaded={ScraperService.getEarlyInterceptScript()}
          userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
    marginRight: 4,
  },
  urlText: {
    flex: 1,
    fontSize: 11,
    color: Theme.colors.textSecondary,
    fontFamily: undefined,
  },
  spinnerWrapper: {
    marginLeft: 4,
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
