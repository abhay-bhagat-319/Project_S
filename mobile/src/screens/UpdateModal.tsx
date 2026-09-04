import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { UpdateInfo, UpdateService } from '../services/UpdateService';

interface UpdateModalProps {
  visible: boolean;
  updateInfo: UpdateInfo | null;
  onClose: () => void;
}

type DownloadStatus = 'IDLE' | 'DOWNLOADING' | 'READY_TO_INSTALL' | 'ERROR';

export default function UpdateModal({ visible, updateInfo, onClose }: UpdateModalProps) {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<DownloadStatus>('IDLE');
  const [progress, setProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');

  if (!updateInfo) return null;

  const handleStartUpdate = async () => {
    if (!updateInfo.apkDownloadUrl) {
      // If no APK attached to release, fallback to GitHub Release page
      await Linking.openURL(updateInfo.htmlUrl);
      onClose();
      return;
    }

    try {
      setStatus('DOWNLOADING');
      setProgress(0);
      setErrorMessage('');

      await UpdateService.downloadAndInstall(
        updateInfo.apkDownloadUrl,
        updateInfo.latestVersion,
        (fraction) => {
          setProgress(fraction);
        }
      );

      setStatus('READY_TO_INSTALL');
    } catch (err: any) {
      console.error('[UpdateModal] Update failed:', err);
      setStatus('ERROR');
      setErrorMessage(err?.message || 'Failed to download or launch package installer.');
    }
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
      onRequestClose={() => {
        if (!isDownloading) onClose();
      }}
      statusBarTranslucent={true}
    >
      <View style={styles.modalOverlay}>
        {/* Backdrop touch to dismiss (disabled during active download) */}
        <TouchableOpacity
          style={styles.modalDismiss}
          activeOpacity={1}
          onPress={() => {
            if (!isDownloading) onClose();
          }}
        />

        {/* Modal Sheet Container */}
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
                  {updateInfo.apkSizeFormatted && (
                    <View style={styles.sizeBadge}>
                      <Ionicons name="cube-outline" size={11} color={Theme.colors.lavender} style={{ marginRight: 3 }} />
                      <Text style={styles.sizeBadgeText}>{updateInfo.apkSizeFormatted}</Text>
                    </View>
                  )}
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

          {/* Download Progress Bar */}
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

          {/* Action Buttons */}
          <View style={styles.actionButtonsContainer}>
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                isDownloading && styles.primaryBtnDisabled
              ]}
              onPress={handleStartUpdate}
              disabled={isDownloading}
              activeOpacity={0.8}
            >
              {isDownloading ? (
                <Text style={styles.primaryBtnText}>Downloading...</Text>
              ) : (
                <>
                  <Ionicons name="download-outline" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.primaryBtnText}>
                    {status === 'ERROR' ? 'Retry Update' : 'Update Now'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.secondaryBtnRow}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleOpenBrowser}
                disabled={isDownloading}
                activeOpacity={0.7}
              >
                <Ionicons name="logo-github" size={15} color={Theme.colors.textSecondary} style={{ marginRight: 5 }} />
                <Text style={styles.secondaryBtnText}>View on GitHub</Text>
              </TouchableOpacity>

              {!isDownloading && (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={onClose}
                  activeOpacity={0.7}
                >
                  <Text style={styles.secondaryBtnText}>Later</Text>
                </TouchableOpacity>
              )}
            </View>
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
  actionButtonsContainer: {
    marginTop: 4,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.primary,
    height: 48,
    borderRadius: 14,
    shadowColor: Theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  secondaryBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 6,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  secondaryBtnText: {
    fontSize: 13,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
});
