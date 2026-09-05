import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';

interface BackgroundDownloadPillProps {
  isDownloading: boolean;
  progress: number;
  isComplete: boolean;
  versionTag: string;
  onPressInstall: () => void;
  onDismiss?: () => void;
}

export default function BackgroundDownloadPill({
  isDownloading,
  progress,
  isComplete,
  versionTag,
  onPressInstall,
  onDismiss,
}: BackgroundDownloadPillProps) {
  if (!isDownloading && !isComplete) return null;

  const percent = Math.round(progress * 100);

  return (
    <View style={styles.pillWrapper} pointerEvents="box-none">
      <TouchableOpacity
        style={[
          styles.pillContainer,
          isComplete ? styles.completeContainer : styles.downloadingContainer
        ]}
        onPress={isComplete ? onPressInstall : undefined}
        activeOpacity={isComplete ? 0.8 : 1}
      >
        <View style={styles.iconWrapper}>
          {isComplete ? (
            <Ionicons name="shield-checkmark" size={18} color="#ffffff" />
          ) : (
            <ActivityIndicator size="small" color="#ffffff" />
          )}
        </View>

        <View style={styles.textWrapper}>
          <Text style={styles.titleText}>
            {isComplete
              ? `Update v${versionTag} Ready`
              : `Downloading v${versionTag}`}
          </Text>
          <Text style={styles.subtitleText}>
            {isComplete ? 'Tap to Install now' : `${percent}% completed`}
          </Text>
        </View>

        {isDownloading && (
          <View style={styles.miniProgressTrack}>
            <View style={[styles.miniProgressFill, { width: `${Math.max(5, percent)}%` }]} />
          </View>
        )}

        {isComplete && (
          <View style={styles.actionArrow}>
            <Ionicons name="arrow-forward-circle" size={20} color="#ffffff" />
          </View>
        )}

        {onDismiss && (
          <TouchableOpacity
            style={styles.dismissBtn}
            onPress={onDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={16} color="rgba(255, 255, 255, 0.7)" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  pillWrapper: {
    position: 'absolute',
    bottom: 92, // Sits comfortably above floating bottom navigation bar
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 999,
  },
  pillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 380,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
  },
  downloadingContainer: {
    backgroundColor: '#312e81', // Indigo deep
    borderColor: Theme.colors.primary,
  },
  completeContainer: {
    backgroundColor: '#15803d', // Green bold
    borderColor: '#22c55e',
  },
  iconWrapper: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  textWrapper: {
    flex: 1,
  },
  titleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitleText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 1,
  },
  miniProgressTrack: {
    width: 50,
    height: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 3,
    overflow: 'hidden',
    marginLeft: 8,
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 3,
  },
  actionArrow: {
    marginLeft: 8,
  },
  dismissBtn: {
    marginLeft: 8,
    padding: 2,
  },
});
