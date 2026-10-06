import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Platform, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Theme } from '../Theme';
import { ScraperService } from '../services/ScraperService';
import { ReportsService } from '../services/ReportsService';
import { NetworkReachabilityService, IISERB_VPN_CONFIG } from '../services/NetworkReachabilityService';
import { CampusConnectionHelper } from '../utils/CampusConnectionHelper';

export interface PortalWebviewHandle {
  handleBackPress: () => boolean;
}

export interface PortalWebviewScreenProps {
  credentials: { username: string; password: string } | null;
  targetUrl?: string | null;
  onClearTargetUrl?: () => void;
}

export interface PortalDownloadState {
  filename: string;
  mimeType: string;
  status: 'DOWNLOADING' | 'SUCCESS' | 'ERROR';
  localUri?: string;
  errorMessage?: string;
  sizeFormatted?: string;
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
  const [isCampusError, setIsCampusError] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // In-session document download state
  const [downloadItem, setDownloadItem] = useState<PortalDownloadState | null>(null);
  const downloadDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register WebView as the authenticated PDF downloader bridge for Reports tab
  useEffect(() => {
    const unregister = ReportsService.registerPdfDownloader((fileUrl, reportId) => {
      const pendingPromise = ReportsService.createPendingPdfDownload(reportId);
      const script = ScraperService.getPdfDownloadScript(fileUrl, reportId);
      webViewRef.current?.injectJavaScript(script);
      return pendingPromise;
    });
    return () => {
      unregister();
      if (downloadDismissTimerRef.current) clearTimeout(downloadDismissTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (targetUrl && targetUrl !== currentUrl) {
      setCurrentUrl(targetUrl);
      setIsCampusError(false);
      webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(targetUrl)}; true;`);
      if (onClearTargetUrl) {
        onClearTargetUrl();
      }
    }
  }, [targetUrl]);

  const openDownloadedFile = async (filePath: string, mimeType: string) => {
    if (Platform.OS === 'android') {
      try {
        const contentUri = await FileSystem.getContentUriAsync(filePath);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: mimeType || 'application/pdf',
        });
      } catch (err) {
        console.warn('Error launching intent for downloaded file, falling back to Linking:', err);
        try {
          await Linking.openURL(filePath);
        } catch {}
      }
    } else {
      try {
        await Linking.openURL(filePath);
      } catch {}
    }
  };

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

  const handleMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (ReportsService.handlePdfMessage(data)) {
        return;
      }
      if (data.type === 'LOGIN_SUBMITTED') {
        console.log('PortalWebview: Auto-login submitted successfully.');
        return;
      }

      // Handle Portal In-Session Downloads
      if (data.type === 'PORTAL_DOWNLOAD_START') {
        if (downloadDismissTimerRef.current) clearTimeout(downloadDismissTimerRef.current);
        setDownloadItem({
          filename: data.filename || 'document.pdf',
          mimeType: data.mimeType || 'application/pdf',
          status: 'DOWNLOADING',
        });
      } else if (data.type === 'PORTAL_DOWNLOAD_COMPLETE') {
        try {
          const downloadsDir = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}portal_downloads/`;
          const dirInfo = await FileSystem.getInfoAsync(downloadsDir);
          if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(downloadsDir, { intermediates: true });
          }

          const safeFilename = (data.filename || `document_${Date.now()}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
          const finalPath = `${downloadsDir}${safeFilename}`;

          await FileSystem.writeAsStringAsync(finalPath, data.base64, {
            encoding: FileSystem.EncodingType.Base64,
          });

          const sizeFormatted = ReportsService.formatBytes(data.sizeBytes);
          const updatedItem: PortalDownloadState = {
            filename: safeFilename,
            mimeType: data.mimeType || 'application/pdf',
            status: 'SUCCESS',
            localUri: finalPath,
            sizeFormatted,
          };
          setDownloadItem(updatedItem);

          // Automatically launch external system viewer
          openDownloadedFile(finalPath, data.mimeType || 'application/pdf');

          // Auto dismiss banner after 6 seconds
          if (downloadDismissTimerRef.current) clearTimeout(downloadDismissTimerRef.current);
          downloadDismissTimerRef.current = setTimeout(() => {
            setDownloadItem(null);
          }, 6000);
        } catch (err: any) {
          setDownloadItem({
            filename: data.filename || 'document',
            mimeType: 'application/octet-stream',
            status: 'ERROR',
            errorMessage: err.message || 'Failed to save downloaded file',
          });
        }
      } else if (data.type === 'PORTAL_DOWNLOAD_ERROR') {
        setDownloadItem({
          filename: data.filename || 'document',
          mimeType: 'application/octet-stream',
          status: 'ERROR',
          errorMessage: data.message || 'Download failed in portal session',
        });
        if (downloadDismissTimerRef.current) clearTimeout(downloadDismissTimerRef.current);
        downloadDismissTimerRef.current = setTimeout(() => {
          setDownloadItem(null);
        }, 5000);
      }
    } catch (e) {}
  };

  const handleLoadEnd = () => {
    setLoading(false);
    setProgress(1);
    setIsCampusError(false);
    NetworkReachabilityService.recordSuccess();
    if (currentUrl && currentUrl.includes('/login') && credentials) {
      webViewRef.current?.injectJavaScript(
        ScraperService.getLoginInjectionScript(credentials.username, credentials.password)
      );
    }
    // Inject desktop viewport, font smoothing, and download interceptor
    webViewRef.current?.injectJavaScript(ScraperService.getDesktopViewportScript());
    webViewRef.current?.injectJavaScript(ScraperService.getPortalDownloadInterceptorScript());
  };

  const handleError = () => {
    setLoading(false);
    setIsCampusError(true);
    NetworkReachabilityService.recordFailure('Portal WebView load error').catch(() => {});
  };

  const handleRetry = () => {
    setIsCampusError(false);
    setLoading(true);
    webViewRef.current?.reload();
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
    setIsCampusError(false);
    webViewRef.current?.reload();
  };

  const goHome = () => {
    setIsCampusError(false);
    webViewRef.current?.injectJavaScript(`window.location.href = "${DEFAULT_URL}"; true;`);
  };

  useImperativeHandle(ref, () => ({
    handleBackPress: () => {
      if (canGoBack && !isCampusError) {
        goBack();
        return true;
      }
      return false;
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

        {/* Floating In-Session Download Status Bar */}
        {downloadItem && (
          <TouchableOpacity
            style={[
              styles.downloadPill,
              downloadItem.status === 'SUCCESS' && styles.downloadPillSuccess,
              downloadItem.status === 'ERROR' && styles.downloadPillError,
            ]}
            onPress={() => {
              if (downloadItem.status === 'SUCCESS' && downloadItem.localUri) {
                openDownloadedFile(downloadItem.localUri, downloadItem.mimeType);
              }
            }}
            activeOpacity={downloadItem.status === 'SUCCESS' ? 0.8 : 1}
          >
            <View style={styles.downloadPillLeft}>
              {downloadItem.status === 'DOWNLOADING' ? (
                <ActivityIndicator size="small" color={Theme.colors.primary} style={{ marginRight: 8 }} />
              ) : downloadItem.status === 'SUCCESS' ? (
                <Ionicons name="checkmark-circle" size={18} color={Theme.colors.success} style={{ marginRight: 8 }} />
              ) : (
                <Ionicons name="alert-circle" size={18} color={Theme.colors.error} style={{ marginRight: 8 }} />
              )}
              <View style={styles.downloadPillTextContainer}>
                <Text style={styles.downloadPillTitle} numberOfLines={1}>
                  {downloadItem.status === 'DOWNLOADING'
                    ? `Downloading ${downloadItem.filename}...`
                    : downloadItem.status === 'SUCCESS'
                    ? `${downloadItem.filename} ${downloadItem.sizeFormatted ? `(${downloadItem.sizeFormatted})` : ''}`
                    : `Download failed`}
                </Text>
                {downloadItem.status === 'SUCCESS' ? (
                  <Text style={styles.downloadPillSubtext}>Downloaded • Tap to open with viewer</Text>
                ) : downloadItem.status === 'ERROR' ? (
                  <Text style={[styles.downloadPillSubtext, { color: Theme.colors.error }]}>
                    {downloadItem.errorMessage || 'Error downloading file'}
                  </Text>
                ) : null}
              </View>
            </View>

            <TouchableOpacity
              style={styles.downloadPillDismiss}
              onPress={() => setDownloadItem(null)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={16} color={Theme.colors.textSecondary} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      </View>

      {/* Embedded Desktop Class Web View or Campus Shield Fallback */}
      <View 
        style={[
          styles.webviewContainer, 
          { marginBottom: Theme.layout.navBarHeight + Math.max(16, insets.bottom + Theme.layout.navBarBaseBottom) + 8 }
        ]}
      >
        {isCampusError ? (
          <View style={styles.fallbackContainer}>
            <View style={styles.fallbackShieldIcon}>
              <Ionicons name="shield-half" size={44} color="#f59e0b" />
            </View>
            <Text style={styles.fallbackTitle}>Campus Network Required</Text>
            <Text style={styles.fallbackSubtitle}>
              The Shiksha Portal is hosted on IISER Bhopal's internal intranet and cannot be accessed over public internet without an active tunnel.
            </Text>

            <View style={styles.vpnInfoBox}>
              <View style={styles.vpnInfoRow}>
                <Ionicons name="server-outline" size={16} color={Theme.colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.vpnInfoLabel}>VPN Gateway:</Text>
                <Text style={styles.vpnInfoVal}>{IISERB_VPN_CONFIG.server}</Text>
              </View>
              <View style={[styles.vpnInfoRow, { marginTop: 6 }]}>
                <Ionicons name="hardware-chip-outline" size={16} color={Theme.colors.primary} style={{ marginRight: 8 }} />
                <Text style={styles.vpnInfoLabel}>Port / Tunnel:</Text>
                <Text style={styles.vpnInfoVal}>{IISERB_VPN_CONFIG.port} ({IISERB_VPN_CONFIG.tunnelName})</Text>
              </View>
            </View>

            <View style={styles.fallbackActions}>
              <TouchableOpacity 
                style={styles.primaryActionBtn} 
                onPress={() => CampusConnectionHelper.launchFortiClient()}
                activeOpacity={0.7}
              >
                <Ionicons name="shield-checkmark" size={18} color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryActionBtnText}>Launch FortiClient VPN</Text>
              </TouchableOpacity>

              <View style={styles.secondaryActionsRow}>
                <TouchableOpacity 
                  style={styles.secondaryActionBtn} 
                  onPress={() => CampusConnectionHelper.openWifiSettings()}
                  activeOpacity={0.7}
                >
                  <Ionicons name="wifi" size={16} color={Theme.colors.textPrimary} style={{ marginRight: 6 }} />
                  <Text style={styles.secondaryActionBtnText}>Wi-Fi Settings</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.retryActionBtn} 
                  onPress={handleRetry}
                  disabled={isRetrying}
                  activeOpacity={0.7}
                >
                  {isRetrying ? (
                    <ActivityIndicator size="small" color={Theme.colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={16} color={Theme.colors.primary} style={{ marginRight: 6 }} />
                      <Text style={styles.retryActionBtnText}>Retry</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
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
            onError={handleError}
            onHttpError={handleError}
            injectedJavaScriptBeforeContentLoaded={ScraperService.getPortalDownloadInterceptorScript()}
            injectedJavaScript={ScraperService.getDesktopViewportScript()}
            userAgent={DESKTOP_USER_AGENT}
            style={styles.webview}
          />
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
  vpnInfoBox: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.card,
    padding: 14,
    marginBottom: 24,
  },
  vpnInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vpnInfoLabel: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    width: 90,
  },
  vpnInfoVal: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
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
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.surface,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    height: 44,
    borderRadius: Theme.radii.pill,
  },
  secondaryActionBtnText: {
    color: Theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  retryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.surface,
    borderWidth: 1,
    borderColor: Theme.colors.primary,
    height: 44,
    borderRadius: Theme.radii.pill,
  },
  retryActionBtnText: {
    color: Theme.colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  downloadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    borderRadius: Theme.radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  downloadPillSuccess: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  downloadPillError: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  downloadPillLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  downloadPillTextContainer: {
    flex: 1,
    marginRight: 8,
  },
  downloadPillTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  downloadPillSubtext: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
    marginTop: 1,
  },
  downloadPillDismiss: {
    padding: 4,
  },
});

export default PortalWebviewScreen;
