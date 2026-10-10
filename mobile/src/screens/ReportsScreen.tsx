import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { ReportsService } from '../services/ReportsService';
import { ReportItem } from '../services/CacheService';
import { NetworkReachabilityService, NetworkState, IISERB_VPN_CONFIG } from '../services/NetworkReachabilityService';
import { CampusConnectionHelper } from '../utils/CampusConnectionHelper';

interface ReportsScreenProps {
  onBack: () => void;
  onRefreshPortal?: () => Promise<void>;
  isSyncing?: boolean;
  networkState?: NetworkState;
  isOffline?: boolean;
}

export default function ReportsScreen({
  onBack,
  onRefreshPortal,
  isSyncing = false,
  networkState: propNetworkState,
  isOffline: propIsOffline = false,
}: ReportsScreenProps) {
  const insets = useSafeAreaInsets();
  const [networkState, setNetworkState] = useState<NetworkState>(
    propNetworkState || NetworkReachabilityService.getCurrentState()
  );
  const [isOffline, setIsOffline] = useState<boolean>(propIsOffline);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeOpeningId, setActiveOpeningId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  useEffect(() => {
    if (propNetworkState) setNetworkState(propNetworkState);
  }, [propNetworkState]);

  useEffect(() => {
    setIsOffline(propIsOffline);
  }, [propIsOffline]);

  // Subscribe to live reachability changes across campus Wi-Fi / VPN
  useEffect(() => {
    const unsubscribe = NetworkReachabilityService.subscribe((state) => {
      setNetworkState(state);
      if (state === 'OFFLINE') {
        setIsOffline(true);
      } else if (state === 'CAMPUS_ACTIVE') {
        setIsOffline(false);
      }
    });
    return unsubscribe;
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const items = await ReportsService.getReports();
      setReports(items);
    } catch (e) {
      console.warn('Failed to load reports:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // When parent sync finishes, reload local reports list
  useEffect(() => {
    if (!isSyncing) {
      loadReports();
      setRefreshing(false);
    }
  }, [isSyncing, loadReports]);

  const handleManualRefresh = async () => {
    if (networkState === 'CAMPUS_CAPTIVE') {
      Alert.alert(
        'Wi-Fi Sign-in Required',
        'Connected to campus Wi-Fi, but captive portal login is required to fetch grade reports.',
        [
          { text: 'Sign In to Wi-Fi', onPress: () => CampusConnectionHelper.openCaptivePortal() },
          { text: 'Wi-Fi Settings', onPress: () => CampusConnectionHelper.openWifiSettings() },
          { text: 'OK', style: 'cancel' }
        ]
      );
      return;
    }

    if (networkState === 'EXTERNAL_ONLINE') {
      Alert.alert(
        'Campus Network Required',
        `Grade reports require an active connection to IISERB Wi-Fi or FortiClient VPN (${IISERB_VPN_CONFIG.server}).`,
        [
          { text: 'Launch FortiClient', onPress: () => CampusConnectionHelper.launchFortiClient() },
          { text: 'Wi-Fi Settings', onPress: () => CampusConnectionHelper.openWifiSettings() },
          { text: 'OK', style: 'cancel' }
        ]
      );
      return;
    }

    if (networkState === 'OFFLINE') {
      Alert.alert('Offline Mode', 'Internet connection required to refresh reports.');
      return;
    }

    setRefreshing(true);
    try {
      const items = await ReportsService.syncReports();
      setReports(items);
    } catch {
      if (onRefreshPortal) {
        try {
          await onRefreshPortal();
        } catch {}
      } else {
        await loadReports();
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenReport = async (item: ReportItem) => {
    if (activeOpeningId) return;

    if (!item.isCached && networkState !== 'CAMPUS_ACTIVE') {
      if (networkState === 'CAMPUS_CAPTIVE') {
        Alert.alert(
          'Wi-Fi Sign-in Required',
          'Please complete captive portal authentication to download this grade report.',
          [
            { text: 'Sign In to Wi-Fi', onPress: () => CampusConnectionHelper.openCaptivePortal() },
            { text: 'OK', style: 'cancel' }
          ]
        );
        return;
      }
      if (networkState === 'EXTERNAL_ONLINE') {
        Alert.alert(
          'Campus Network Required',
          `Downloading new grade reports requires IISERB Wi-Fi or FortiClient VPN (${IISERB_VPN_CONFIG.server}).`,
          [
            { text: 'Launch FortiClient', onPress: () => CampusConnectionHelper.launchFortiClient() },
            { text: 'Wi-Fi Settings', onPress: () => CampusConnectionHelper.openWifiSettings() },
            { text: 'OK', style: 'cancel' }
          ]
        );
        return;
      }
      if (networkState === 'OFFLINE') {
        Alert.alert('Offline Mode', 'Internet connection required to download this report.');
        return;
      }
    }

    setActiveOpeningId(item.id);
    setDownloadProgress(0);

    try {
      await ReportsService.openReport(item, (fraction) => {
        setDownloadProgress(fraction);
      });
      // Refresh local cache indicators
      await loadReports();
    } catch (err: any) {
      console.warn('Error opening report PDF:', err);
      Alert.alert(
        'Could Not Open Report',
        err?.message || 'Failed to download or open the PDF report. Please check your connection and try again.'
      );
    } finally {
      setActiveOpeningId(null);
      setDownloadProgress(0);
    }
  };

  const renderReportCard = ({ item }: { item: ReportItem }) => {
    const isOpeningThis = activeOpeningId === item.id;
    const isCumulative = item.type.toLowerCase().includes('cumulative') || item.annotation.toLowerCase().includes('cumulative');
    const displayTitle = ReportsService.formatReportTitle(item);

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.75}
        onPress={() => handleOpenReport(item)}
        disabled={isOpeningThis}
      >
        <View style={styles.cardContent}>
          {/* Left Icon Pill */}
          <View style={[
            styles.iconContainer,
            { backgroundColor: isCumulative ? 'rgba(255, 214, 232, 0.18)' : 'rgba(139, 120, 255, 0.15)' }
          ]}>
            <Ionicons
              name={isCumulative ? 'ribbon' : 'document-text'}
              size={22}
              color={isCumulative ? Theme.colors.pink : Theme.colors.primary}
            />
          </View>

          {/* Minimal Title Text */}
          <View style={styles.textContainer}>
            <Text style={styles.reportTitle} numberOfLines={2}>
              {displayTitle}
            </Text>
            {item.fileSizeFormatted ? (
              <Text style={styles.reportMetaText}>
                PDF • {item.fileSizeFormatted}
              </Text>
            ) : (
              <Text style={styles.reportMetaText}>
                PDF Document
              </Text>
            )}
          </View>

          {/* Action / Progress Indicator */}
          <View style={styles.actionContainer}>
            {isOpeningThis ? (
              <View style={styles.progressWrap}>
                <ActivityIndicator size="small" color={Theme.colors.primary} />
                {downloadProgress > 0 && downloadProgress < 1 && (
                  <Text style={styles.progressText}>{Math.round(downloadProgress * 100)}%</Text>
                )}
              </View>
            ) : item.isCached ? (
              <View style={styles.cachedBadge}>
                <Ionicons name="checkmark-circle" size={18} color={Theme.colors.mint} />
              </View>
            ) : (
              <View style={styles.openArrow}>
                <Ionicons name="chevron-forward" size={18} color={Theme.colors.textSecondary} />
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const isCompleteOffline = networkState === 'OFFLINE' || (isOffline && networkState !== 'EXTERNAL_ONLINE' && networkState !== 'CAMPUS_ACTIVE' && networkState !== 'CAMPUS_CAPTIVE');
  const isCaptive = networkState === 'CAMPUS_CAPTIVE';
  const isExternalOnline = networkState === 'EXTERNAL_ONLINE';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={onBack}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={Theme.colors.textPrimary} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Grade Reports</Text>

        <TouchableOpacity
          style={styles.headerButton}
          onPress={handleManualRefresh}
          activeOpacity={0.7}
          disabled={refreshing || isSyncing}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {refreshing || isSyncing ? (
            <ActivityIndicator size="small" color={Theme.colors.primary} />
          ) : (
            <Ionicons name="refresh" size={22} color={Theme.colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* Network Status Banners */}
      {isCompleteOffline ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={15} color="#ffffff" />
          <Text style={styles.bannerText}>No internet connection. Viewing offline reports cache.</Text>
        </View>
      ) : isCaptive ? (
        <TouchableOpacity 
          style={styles.campusBanner}
          activeOpacity={0.8}
          onPress={() => CampusConnectionHelper.openCaptivePortal()}
        >
          <Ionicons name="warning-outline" size={14} color="#f59e0b" />
          <Text style={styles.campusBannerText}>Wi-Fi Sign-in Required • Tap to sign into campus Wi-Fi</Text>
        </TouchableOpacity>
      ) : isExternalOnline ? (
        <TouchableOpacity 
          style={styles.campusBanner}
          activeOpacity={0.8}
          onPress={() => CampusConnectionHelper.launchFortiClient()}
        >
          <Ionicons name="shield-half" size={14} color="#f59e0b" />
          <Text style={styles.campusBannerText}>Campus Network Required • Connect to IISERB Wi-Fi or VPN to refresh</Text>
        </TouchableOpacity>
      ) : null}

      {/* Main List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Theme.colors.primary} />
          <Text style={styles.loadingText}>Loading reports...</Text>
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="newspaper-outline" size={42} color={Theme.colors.textSecondary} />
          </View>
          <Text style={styles.emptyTitle}>No Grade Reports Found</Text>
          <Text style={styles.emptySubtitle}>
            Pull down or tap the refresh button above to fetch grade reports from Shiksha portal.
          </Text>
          <TouchableOpacity
            style={styles.emptyRefreshBtn}
            activeOpacity={0.8}
            onPress={handleManualRefresh}
            disabled={refreshing || isSyncing}
          >
            <Ionicons name="refresh" size={16} color={Theme.colors.textDark} style={{ marginRight: 6 }} />
            <Text style={styles.emptyRefreshBtnText}>
              {refreshing || isSyncing ? 'Syncing...' : 'Refresh Reports'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => item.id}
          renderItem={renderReportCard}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Theme.layout.baseScrollBottomPadding + insets.bottom + 16 }
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || isSyncing}
              onRefresh={handleManualRefresh}
              tintColor={Theme.colors.primary}
              colors={[Theme.colors.primary]}
              progressBackgroundColor={Theme.colors.surface}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
    letterSpacing: 0.2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  card: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.widget,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  textContainer: {
    flex: 1,
    marginRight: 10,
  },
  reportTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
    lineHeight: 20,
    marginBottom: 4,
  },
  reportMetaText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  actionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: {
    fontSize: 10,
    color: Theme.colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  cachedBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(208, 240, 228, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  openArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Theme.colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  emptyRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: Theme.radii.pill,
  },
  emptyRefreshBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  offlineBanner: {
    backgroundColor: Theme.colors.error,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: Theme.spacing.padding,
  },
  bannerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  campusBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.3)',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: Theme.spacing.padding,
  },
  campusBannerText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 6,
  },
});
