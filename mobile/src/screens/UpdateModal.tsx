import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { UpdateInfo, UpdateService } from '../services/UpdateService';

interface UpdateModalProps {
  visible: boolean;
  updateInfo: UpdateInfo | null;
  onClose: () => void;
  onSnooze?: (versionTag: string) => void;
}

type DownloadStatus = 'IDLE' | 'DOWNLOADING' | 'READY_TO_INSTALL' | 'ERROR';

export default function UpdateModal({
  visible,
  updateInfo,
  onClose,
  onSnooze,
}: UpdateModalProps) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<DownloadStatus>('IDLE');
  const [progress, setProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isApkCached, setIsApkCached] = useState<boolean>(false);

  useEffect(() => {
    if (visible && updateInfo) {
      checkCacheStatus();
      setErrorMessage('');

      // Check if already downloading in background
      if (UpdateService.isDownloading(updateInfo.latestVersion)) {
        setStatus('DOWNLOADING');
      } else {
        setStatus('IDLE');
      }
    }
  }, [visible, updateInfo]);

  // Subscribe to live background download progress
  useEffect(() => {
    if (!visible || !updateInfo) return;

    const unsubscribe = UpdateService.addProgressListener((fraction) => {
      setProgress(fraction);
      if (fraction >= 1) {
        setIsApkCached(true);
        setStatus('READY_TO_INSTALL');
      } else if (fraction > 0) {
        setStatus('DOWNLOADING');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [visible, updateInfo]);

  const checkCacheStatus = async () => {
    if (!updateInfo) return;
    const cached = await UpdateService.isApkCached(
      updateInfo.latestVersion,
      updateInfo.apkSizeBytes
    );
    setIsApkCached(cached);
    if (cached) {
      setStatus('READY_TO_INSTALL');
    }
  };

  if (!updateInfo) return null;

  const handleDownloadOrInstall = async () => {
    if (!updateInfo.apkDownloadUrl && !isApkCached) {
      await Linking.openURL(updateInfo.htmlUrl);
      onClose();
      return;
    }

    // If already cached, launch the installer immediately
    if (isApkCached) {
      try {
        await UpdateService.installCachedApk(updateInfo.latestVersion);
      } catch (err: any) {
        console.error('[UpdateModal] Install trigger failed:', err);
      }
      return;
    }

    // If "Download Update" is clicked, initiate background download and close modal immediately
    // so user can freely interact with the app while the floating progress pill shows progress.
    const downloadUrl = updateInfo.apkDownloadUrl;
    const version = updateInfo.latestVersion;
    const size = updateInfo.apkSizeBytes;

    // Immediately dismiss modal
    onClose();

    // Start background download stream
    UpdateService.downloadApk(downloadUrl!, version, size).catch((err: any) => {
      console.warn('[UpdateModal] Background download initiation error:', err);
    });
  };

  const handleRemindLater = async () => {
    await UpdateService.snoozeUpdate(updateInfo.latestVersion);
    if (onSnooze) {
      onSnooze(updateInfo.latestVersion);
    }
    onClose();
  };

  const handleOpenBrowser = async () => {
    await Linking.openURL(updateInfo.htmlUrl);
    onClose();
  };

  const isDownloading = status === 'DOWNLOADING';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalDismiss}
          activeOpacity={1}
          onPress={onClose}
        />

        <View
          style={[
            styles.modalContainer,
            { paddingBottom: Math.max(24, insets.bottom + 16) },
          ]}
        >
          {/* Sheet Handle */}
          <View style={styles.sheetHandle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconBadge}>
                <Ionicons name="sparkles" size={22} color={Theme.colors.primary} />
              </View>
              <View style={styles.titleWrapper}>
                <Text style={styles.modalTitle}>New Update Available</Text>
                <View style={styles.versionRow}>
                  <View style={styles.versionBadge}>
                    <Text style={styles.currentVersionText}>v{updateInfo.currentVersion}</Text>
                    <Ionicons
                      name="arrow-forward"
                      size={12}
                      color={Theme.colors.textSecondary}
                      style={{ marginHorizontal: 4 }}
                    />
                    <Text style={styles.latestVersionText}>v{updateInfo.latestVersion}</Text>
                  </View>
                  {updateInfo.apkArchitecture === 'arm64-v8a' && (
                    <View style={[styles.sizeBadge, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
                      <Ionicons
                        name="hardware-chip-outline"
                        size={11}
                        color={Theme.colors.primary}
                        style={{ marginRight: 3 }}
                      />
                      <Text style={[styles.sizeBadgeText, { color: Theme.colors.primary }]}>ARM64</Text>
                    </View>
                  )}
                  {isApkCached ? (
                    <View style={[styles.sizeBadge, { backgroundColor: 'rgba(34, 197, 94, 0.15)' }]}>
                      <Ionicons name="checkmark-done" size={12} color="#22c55e" style={{ marginRight: 3 }} />
                      <Text style={[styles.sizeBadgeText, { color: '#22c55e' }]}>Downloaded</Text>
                    </View>
                  ) : updateInfo.apkSizeFormatted ? (
                    <View style={styles.sizeBadge}>
                      <Ionicons name="cube-outline" size={11} color={Theme.colors.lavender} style={{ marginRight: 3 }} />
                      <Text style={styles.sizeBadgeText}>{updateInfo.apkSizeFormatted}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={18} color={Theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Release Title */}
          {updateInfo.releaseName ? (
            <Text style={styles.releaseNameText}>{updateInfo.releaseName}</Text>
          ) : null}

          {/* Changelog Card */}
          <View style={styles.changelogCard}>
            <View style={styles.changelogHeader}>
              <Ionicons name="document-text-outline" size={14} color={Theme.colors.textSecondary} />
              <Text style={styles.changelogTitle}>What's New</Text>
            </View>
            <ScrollView style={styles.changelogScroll} nestedScrollEnabled={true}>
              <Text style={styles.changelogText}>
                {updateInfo.releaseNotes || 'Bug fixes, stability, and performance improvements.'}
              </Text>
            </ScrollView>
          </View>

          {/* Active Download Progress Section */}
          {isDownloading && (
            <View style={styles.progressSection}>
              <View style={styles.progressInfoRow}>
                <View style={styles.progressStatusRow}>
                  <ActivityIndicator size="small" color={Theme.colors.primary} style={{ marginRight: 6 }} />
                  <Text style={styles.progressStatusText}>Downloading update in background...</Text>
                </View>
                <Text style={styles.progressPercentText}>{Math.round(progress * 100)}%</Text>
              </View>

              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.max(5, Math.min(100, progress * 100))}%` },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Error Banner */}
          {status === 'ERROR' && (
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle" size={18} color="#ef4444" style={{ marginRight: 8 }} />
              <Text style={styles.errorText} numberOfLines={2}>
                {errorMessage}
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionButtonsContainer}>
            {/* Primary Action Button */}
            <TouchableOpacity
              style={[
                styles.actionBtn,
                isApkCached ? styles.installBtn : styles.primaryBtn,
                isDownloading && styles.downloadingBtn,
              ]}
              onPress={handleDownloadOrInstall}
              activeOpacity={0.8}
            >
              {isDownloading ? (
                <View style={styles.btnRow}>
                  <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryBtnText}>Downloading ({Math.round(progress * 100)}%)...</Text>
                </View>
              ) : (
                <View style={styles.btnRow}>
                  <Ionicons
                    name={isApkCached ? 'shield-checkmark-outline' : 'cloud-download-outline'}
                    size={18}
                    color="#ffffff"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.primaryBtnText}>
                    {isApkCached ? 'Install Now' : status === 'ERROR' ? 'Retry Download' : 'Download Update'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Secondary Action: Remind Later */}
            <TouchableOpacity
              style={[styles.actionBtn, styles.tertiaryActionBtn]}
              onPress={handleRemindLater}
              activeOpacity={0.8}
            >
              <Ionicons name="time-outline" size={16} color={Theme.colors.textSecondary} style={{ marginRight: 6 }} />
              <Text style={styles.tertiaryActionBtnText}>Remind Me Later</Text>
            </TouchableOpacity>

            {/* GitHub Release Link */}
            <TouchableOpacity
              style={styles.gitHubLink}
              onPress={handleOpenBrowser}
              activeOpacity={0.7}
            >
              <Ionicons name="logo-github" size={14} color={Theme.colors.textSecondary} style={{ marginRight: 5 }} />
              <Text style={styles.gitHubLinkText}>View Release on GitHub</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.70)',
    justifyContent: 'flex-end',
  },
  modalDismiss: {
    flex: 1,
  },
  modalContainer: {
    width: '100%',
    backgroundColor: Theme.colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: Theme.spacing.padding,
    paddingTop: 10,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Theme.colors.border,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
  },
  titleWrapper: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Theme.colors.textPrimary,
    letterSpacing: -0.3,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
    gap: 6,
  },
  versionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  currentVersionText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
  },
  latestVersionText: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.primary,
  },
  sizeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  sizeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.lavender,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Theme.colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  releaseNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.lavender,
    marginBottom: 10,
  },
  changelogCard: {
    backgroundColor: Theme.colors.surfaceLight,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    maxHeight: 140,
  },
  changelogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  changelogTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 5,
  },
  changelogScroll: {
    maxHeight: 100,
  },
  changelogText: {
    fontSize: 13,
    lineHeight: 18,
    color: Theme.colors.textPrimary,
  },
  progressSection: {
    backgroundColor: Theme.colors.surfaceLight,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  progressInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  progressPercentText: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Theme.colors.primary,
    borderRadius: 3,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '500',
  },
  actionButtonsContainer: {
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    backgroundColor: Theme.colors.primary,
  },
  installBtn: {
    backgroundColor: '#16a34a', // Fresh green
  },
  downloadingBtn: {
    backgroundColor: '#4338ca',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  tertiaryActionBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingVertical: 12,
  },
  tertiaryActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
  },
  gitHubLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    marginTop: 2,
  },
  gitHubLinkText: {
    fontSize: 12,
    fontWeight: '500',
    color: Theme.colors.textSecondary,
  },
});
