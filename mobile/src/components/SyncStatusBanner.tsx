import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';

export interface SyncStatusBannerProps {
  /** Set when the most recent sync attempt failed; null hides the banner. */
  error: { scope?: string; code: string; message: string } | null;
  /** Epoch ms of the most recent successful sync of any scope (for "showing data from ..."). */
  lastSyncAt: number | null;
  /** True while a retry triggered from the banner is running. */
  retrying?: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

type Tone = 'offline' | 'expired' | 'parse';

interface ToneSpec {
  tone: Tone;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  title: string;
}

/**
 * Maps a PortalErrorCode to a banner presentation.
 *
 * The point of this component is that a failed refresh must never look like
 * "you have no attendance/courses/reports". The user always gets (a) the reason,
 * (b) the age of the data still on screen, and (c) a retry affordance.
 */
function describe(error: { scope?: string; code: string; message: string }): ToneSpec {
  switch (error.code) {
    case 'SESSION_EXPIRED':
      return {
        tone: 'expired',
        icon: 'key-outline',
        color: '#f59e0b',
        title: 'Portal session expired',
      };
    case 'TIMEOUT':
      return {
        tone: 'offline',
        icon: 'time-outline',
        color: '#f59e0b',
        title: 'Portal timed out',
      };
    case 'CIRCUIT_OPEN':
    case 'NETWORK_ERROR':
      return {
        tone: 'offline',
        icon: 'cloud-offline-outline',
        color: '#f59e0b',
        title: 'Portal not responding',
      };
    case 'PARSE_ERROR':
    case 'EMPTY_RESPONSE':
      return {
        tone: 'parse',
        icon: 'alert-circle-outline',
        color: '#f97316',
        title: 'Portal returned unexpected data',
      };
    case 'SERVER_ERROR':
      return {
        tone: 'offline',
        icon: 'warning-outline',
        color: '#f59e0b',
        title: 'Shiksha server error',
      };
    default:
      return {
        tone: 'offline',
        icon: 'cloud-offline-outline',
        color: '#f59e0b',
        title: 'Sync failed',
      };
  }
}

function formatAge(timestampMs: number | null): string {
  if (!timestampMs) return '';
  const diff = Date.now() - timestampMs;
  if (diff < 60_000) return 'just now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export default function SyncStatusBanner({
  error,
  lastSyncAt,
  retrying = false,
  onRetry,
  onDismiss,
}: SyncStatusBannerProps) {
  if (!error) return null;

  const spec = describe(error);
  const age = formatAge(lastSyncAt);

  return (
    <View style={[styles.container, { borderLeftColor: spec.color }]}>
      <Ionicons name={spec.icon} size={18} color={spec.color} style={styles.icon} />

      <View style={styles.textColumn}>
        <Text style={styles.title}>{spec.title}</Text>
        <Text style={styles.message} numberOfLines={2}>
          {error.message}
        </Text>
        {age ? (
          <Text style={styles.age}>Showing saved data from {age}</Text>
        ) : (
          <Text style={styles.age}>No saved data yet — pull down anywhere to retry.</Text>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={onRetry}
          disabled={retrying}
          activeOpacity={0.75}
        >
          {retrying ? (
            <ActivityIndicator size="small" color={Theme.colors.textPrimary} />
          ) : (
            <Ionicons name="refresh" size={16} color={Theme.colors.textPrimary} />
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} activeOpacity={0.6}>
          <Ionicons name="close" size={16} color={Theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    borderLeftWidth: 3,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.25)',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  icon: {
    marginTop: 2,
    marginRight: 10,
  },
  textColumn: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
  },
  message: {
    fontSize: 11.5,
    color: Theme.colors.textSecondary,
    marginTop: 2,
    lineHeight: 15,
  },
  age: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: '600',
    marginTop: 3,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  retryBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  dismissBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
