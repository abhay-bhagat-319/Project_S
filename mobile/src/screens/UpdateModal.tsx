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
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { UpdateInfo, UpdateService } from '../services/UpdateService';

interface UpdateModalProps {
  visible: boolean;
  updateInfo: UpdateInfo | null;
  onClose: () => void;
  onStartBackgroundDownload?: (info: UpdateInfo) => void;
  onSnooze?: (versionTag: string) => void;
  isBackgroundDownloading?: boolean;
}

type DownloadStatus = 'IDLE' | 'DOWNLOADING' | 'READY_TO_INSTALL' | 'ERROR';
type ActiveInfoKey = 'DOWNLOAD_NOW' | 'DOWNLOAD_BG' | 'REMIND_LATER' | 'INSTALL_NOW' | null;

export default function UpdateModal({
  visible,
  updateInfo,
  onClose,
  onStartBackgroundDownload,
  onSnooze,
  isBackgroundDownloading = false,
}: UpdateModalProps) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<DownloadStatus>('IDLE');
  const [progress, setProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isApkCached, setIsApkCached] = useState<boolean>(false);
  const [activeInfo, setActiveInfo] = useState<ActiveInfoKey>(null);

  useEffect(() => {
    if (visible && updateInfo) {
      checkCacheStatus();
      setActiveInfo(null);
      setStatus('IDLE');
      setProgress(0);
      setErrorMessage('');
    }
  }, [visible, updateInfo]);

  const checkCacheStatus = async () => {
    if (!updateInfo) return;
    const cached = await UpdateService.isApkCached(
      updateInfo.latestVersion,
      updateInfo.apkSizeBytes
    );
    setIsApkCached(cached);
  };

  if (!updateInfo) return null;

  const handleForegroundDownloadOrInstall = async () => {
    if (!updateInfo.apkDownloadUrl && !isApkCached) {
      await Linking.openURL(updateInfo.htmlUrl);
      onClose();
      return;
    }

    try {
      if (isApkCached) {
        await UpdateService.installCachedApk(updateInfo.latestVersion);
        onClose();
        return;
      }

      setStatus('DOWNLOADING');
      setProgress(0);
      setErrorMessage('');

      await UpdateService.downloadAndInstall(
        updateInfo.apkDownloadUrl!,
        updateInfo.latestVersion,
        updateInfo.apkSizeBytes,
        (fraction) => {
          setProgress(fraction);
        }
      );

      setStatus('READY_TO_INSTALL');
      setIsApkCached(true);
    } catch (err: any) {
      console.error('[UpdateModal] Update failed:', err);
      setStatus('ERROR');
      setErrorMessage(err?.message || 'Failed to download or launch package installer.');
    }
  };

  const handleBackgroundDownload = () => {
    if (onStartBackgroundDownload) {
      onStartBackgroundDownload(updateInfo);
    }
    onClose();
  };

  const handleRemindLater = async () => {
    await UpdateService.snoozeUpdate(updateInfo.latestVersion);
    if (onSnooze) {
      onSnooze(updateInfo.latestVersion);
    }
    onClose();
    Alert.alert(
      'Update Snoozed',
      'You will not be reminded for 24 hours. You can update anytime from the Settings menu.',
      [{ text: 'OK' }]
    );
  };

  const handleOpenBrowser = async () => {
    await Linking.openURL(updateInfo.htmlUrl);
    onClose();
  };

  const toggleInfo = (key: ActiveInfoKey) => {
    setActiveInfo((prev) => (prev === key ? null : key));
  };

  const isDownloading = status === 'DOWNLOADING';

  const infoDescriptions: Record<string, { title: string; desc: string; icon: any }> = {
    DOWNLOAD_NOW: {
      title: 'Download Now',
      desc: 'Downloads the complete package actively on this screen and launches the Android Package Installer immediately.',
      icon: 'download-outline',
    },
    INSTALL_NOW: {
      title: 'Install Now',
      desc: 'The update package is already verified and saved on your phone. Opens the installer instantly without downloading again.',
      icon: 'checkmark-circle-outline',
    },
    DOWNLOAD_BG: {
      title: 'Download in Background',
      desc: 'Downloads the update in the background while you continue using the app freely. You will see a live progress bar at the bottom.',
      icon: 'cloud-download-outline',
    },
    REMIND_LATER: {
      title: 'Remind Me Later',
      desc: 'Snoozes this update prompt for 24 hours. Note: Some institutional portal scrapers or features might not work properly on older versions.',
      icon: 'time-outline',
    },
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={() => {
        if (!isDownloading) onClose();
      }}
      statusBarTranslucent={true}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalDismiss}
          activeOpacity={1}
          onPress={() => {
            if (!isDownloading) onClose();
          }}
        />

        <View
          style={[
            styles.modalContainer,
            { paddingBottom: Math.max(24, insets.bottom + 16) }
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
                    <Ionicons name="arrow-forward" size={12} color={Theme.colors.textSecondary} style={{ marginHorizontal: 4 }} />
                    <Text style={styles.latestVersionText}>v{updateInfo.latestVersion}</Text>
                  </View>
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

            {!isDownloading && (
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
                <Ionicons name="close" size={18} color={Theme.colors.textPrimary} />
              </TouchableOpacity>
            )}
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

          {/* Active Info Tooltip Card */}
          {activeInfo && infoDescriptions[activeInfo] && (
            <View style={styles.infoBox}>
              <View style={styles.infoHeaderRow}>
                <Ionicons name={infoDescriptions[activeInfo].icon} size={15} color={Theme.colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.infoTitle}>{infoDescriptions[activeInfo].title}</Text>
                <TouchableOpacity onPress={() => setActiveInfo(null)} style={{ marginLeft: 'auto' }}>
                  <Ionicons name="close-circle" size={16} color={Theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.infoDesc}>{infoDescriptions[activeInfo].desc}</Text>
            </View>
          )}

          {/* Active Download Progress Section */}
          {isDownloading && (
            <View style={styles.progressSection}>
              <View style={styles.progressInfoRow}>
                <View style={styles.progressStatusRow}>
                  <ActivityIndicator size="small" color={Theme.colors.primary} style={{ marginRight: 6 }} />
                  <Text style={styles.progressStatusText}>Downloading package...</Text>
                </View>
                <Text style={styles.progressPercentText}>{Math.round(progress * 100)}%</Text>
              </View>

              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.max(5, Math.min(100, progress * 100))}%` }
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

          {/* 3 Action Buttons Stack */}
          <View style={styles.actionButtonsContainer}>
            {/* Button 1: Download Now / Install Now */}
            <View style={styles.buttonWithInfoRow}>
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  isApkCached ? styles.installBtn : styles.primaryBtn,
                  isDownloading && styles.primaryBtnDisabled
                ]}
                onPress={handleForegroundDownloadOrInstall}
                disabled={isDownloading}
                activeOpacity={0.8}
              >
                {isDownloading ? (
                  <Text style={styles.primaryBtnText}>Downloading ({Math.round(progress * 100)}%)...</Text>
                ) : (
                  <>
                    <Ionicons
                      name={isApkCached ? 'shield-checkmark-outline' : 'download-outline'}
                      size={18}
                      color="#ffffff"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.primaryBtnText}>
                      {isApkCached ? 'Install Now' : status === 'ERROR' ? 'Retry Download' : 'Download Now'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.infoIconBtn}
                onPress={() => toggleInfo(isApkCached ? 'INSTALL_NOW' : 'DOWNLOAD_NOW')}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={activeInfo === (isApkCached ? 'INSTALL_NOW' : 'DOWNLOAD_NOW') ? Theme.colors.primary : Theme.colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            {/* Button 2: Download in Background (Hidden if already cached) */}
            {!isApkCached && !isDownloading && (
              <View style={styles.buttonWithInfoRow}>
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    styles.secondaryActionBtn,
                    isBackgroundDownloading && styles.primaryBtnDisabled
                  ]}
                  onPress={handleBackgroundDownload}
                  disabled={isBackgroundDownloading}
                  activeOpacity={0.8}
                >
                  <Ionicons name="cloud-download-outline" size={17} color={Theme.colors.textPrimary} style={{ marginRight: 6 }} />
                  <Text style={styles.secondaryActionBtnText}>
                    {isBackgroundDownloading ? 'Downloading in background...' : 'Download in Background'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.infoIconBtn}
                  onPress={() => toggleInfo('DOWNLOAD_BG')}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={20}
                    color={activeInfo === 'DOWNLOAD_BG' ? Theme.colors.primary : Theme.colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            )}

            {/* Button 3: Remind Me Later */}
            {!isDownloading && (
              <View style={styles.buttonWithInfoRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.tertiaryActionBtn]}
                  onPress={handleRemindLater}
                  activeOpacity={0.8}
                >
                  <Ionicons name="time-outline" size={16} color={Theme.colors.textSecondary} style={{ marginRight: 6 }} />
                  <Text style={styles.tertiaryActionBtnText}>Remind Me Later</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.infoIconBtn}
                  onPress={() => toggleInfo('REMIND_LATER')}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={20}
                    color={activeInfo === 'REMIND_LATER' ? Theme.colors.primary : Theme.colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            )}

            {/* GitHub Link footer */}
            <TouchableOpacity
              style={styles.gitHubLink}
              onPress={handleOpenBrowser}
              disabled={isDownloading}
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
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Theme.colors.border,
    alignSelf: 'center',
    marginBottom: 14,
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
    marginRight: 10,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  titleWrapper: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
    letterSpacing: -0.3,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  versionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  currentVersionText: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  latestVersionText: {
    fontSize: 11,
    color: Theme.colors.primary,
    fontWeight: '700',
  },
  sizeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
    backgroundColor: 'rgba(165, 180, 252, 0.1)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sizeBadgeText: {
    fontSize: 11,
    color: Theme.colors.lavender,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Theme.colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  releaseNameText: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
    marginBottom: 10,
  },
  changelogCard: {
    backgroundColor: Theme.colors.background,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: 14,
  },
  changelogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  changelogTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
    marginLeft: 5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  changelogScroll: {
    maxHeight: 120,
  },
  changelogText: {
    fontSize: 13,
    lineHeight: 19,
    color: Theme.colors.textSecondary,
  },
  progressSection: {
    marginBottom: 14,
    backgroundColor: Theme.colors.surfaceLight,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.colors.border,
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
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  progressPercentText: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.primary,
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#ef4444',
  },
  infoBox: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
    marginBottom: 12,
  },
  infoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.primary,
  },
  infoDesc: {
    fontSize: 12,
    lineHeight: 17,
    color: Theme.colors.textPrimary,
  },
  actionButtonsContainer: {
    marginTop: 4,
    gap: 8,
  },
  buttonWithInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    borderRadius: 13,
  },
  primaryBtn: {
    backgroundColor: Theme.colors.primary,
    shadowColor: Theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  installBtn: {
    backgroundColor: '#16a34a', // Green for instant install
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  secondaryActionBtn: {
    backgroundColor: Theme.colors.surfaceLight,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  secondaryActionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  tertiaryActionBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  tertiaryActionBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: Theme.colors.textSecondary,
  },
  infoIconBtn: {
    width: 40,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  gitHubLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: 2,
  },
  gitHubLinkText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
});
