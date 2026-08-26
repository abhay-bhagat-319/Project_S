import React from 'react';
import { StyleSheet, Text, View, FlatList, RefreshControl, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';
import { AttendanceItem, AttendanceData } from '../services/CacheService';
import { calculateAttendance } from '../utils/AttendanceCalc';

interface AttendanceScreenProps {
  attendanceData: AttendanceData | null;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  isOffline: boolean;
}

export default function AttendanceScreen({ attendanceData, onRefresh, refreshing, isOffline }: AttendanceScreenProps) {

  const renderAttendanceItem = ({ item }: { item: AttendanceItem }) => {
    const { percentage, isAbove, message } = calculateAttendance(item.present, item.totalClasses);
    
    return (
      <View style={[
        styles.card, 
        !isAbove && styles.warningCard
      ]}>
        <View style={styles.cardHeader}>
          <View style={styles.titleColumn}>
            <Text style={styles.courseCode}>{item.courseCode}</Text>
            <Text style={styles.courseTitle} numberOfLines={1}>{item.courseTitle}</Text>
          </View>
          <View style={styles.percentContainer}>
            <Text style={[
              styles.percentageText,
              { color: isAbove ? Theme.colors.success : Theme.colors.error }
            ]}>
              {percentage.toFixed(1)}%
            </Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressBarBg}>
          <View style={[
            styles.progressBarFill, 
            { 
              width: `${Math.min(100, percentage)}%`,
              backgroundColor: isAbove ? Theme.colors.primary : Theme.colors.error
            }
          ]} />
        </View>

        <View style={styles.statsRow}>
          <Text style={styles.statText}>Conducted: <Text style={styles.statVal}>{item.totalClasses}</Text></Text>
          <Text style={styles.statText}>Present: <Text style={[styles.statVal, { color: Theme.colors.success }]}>{item.present}</Text></Text>
          <Text style={styles.statText}>Absent: <Text style={[styles.statVal, { color: Theme.colors.error }]}>{item.absent}</Text></Text>
        </View>

        <View style={[
          styles.alertContainer,
          { backgroundColor: isAbove ? 'rgba(139, 120, 255, 0.08)' : 'rgba(255, 94, 94, 0.08)' }
        ]}>
          <Ionicons 
            name={isAbove ? "information-circle-outline" : "warning-outline"} 
            size={18} 
            color={isAbove ? Theme.colors.primary : Theme.colors.error} 
            style={styles.alertIcon}
          />
          <Text style={[
            styles.alertText,
            { color: isAbove ? Theme.colors.textPrimary : Theme.colors.error }
          ]}>
            {message}
          </Text>
        </View>
      </View>
    );
  };

  const formattedSyncTime = () => {
    if (!attendanceData) return '';
    try {
      const date = new Date(attendanceData.timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString();
    } catch (e) {
      return '';
    }
  };

  return (
    <View style={styles.container}>
      
      {/* Warning/Status Banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Theme.colors.background} />
          <Text style={styles.bannerText}>No internet connection. Viewing offline cache.</Text>
        </View>
      )}
      
      {!isOffline && attendanceData && (
        <View style={styles.syncBanner}>
          <Ionicons name="sync-outline" size={14} color={Theme.colors.textSecondary} />
          <Text style={styles.syncBannerText}>Viewing cached data from {formattedSyncTime()}</Text>
        </View>
      )}

      <FlatList
        data={attendanceData?.items || []}
        keyExtractor={(item) => item.courseCode}
        renderItem={renderAttendanceItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Theme.colors.primary]}
            tintColor={Theme.colors.primary}
            titleColor={Theme.colors.textSecondary}
          />
        }
        ListEmptyComponent={
          <ScrollView 
            contentContainerStyle={styles.emptyContainer}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
          >
            <Ionicons name="calendar-outline" size={54} color={Theme.colors.textSecondary} />
            <Text style={styles.emptyTitle}>No Attendance Data</Text>
            <Text style={styles.emptySub}>Swipe down to check portal data and sync.</Text>
          </ScrollView>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  listContent: {
    padding: Theme.spacing.padding,
    paddingTop: 10,
    paddingBottom: 40,
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
    color: Theme.colors.background,
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  syncBannerText: {
    color: Theme.colors.textSecondary,
    fontSize: 11,
    marginLeft: 6,
  },
  card: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.card,
    padding: Theme.spacing.padding,
    marginBottom: Theme.spacing.gap,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  warningCard: {
    borderColor: Theme.colors.error,
    borderWidth: 1.5,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleColumn: {
    flex: 1,
    marginRight: 10,
  },
  courseCode: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Theme.colors.primary,
  },
  courseTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
    marginTop: 4,
  },
  percentContainer: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Theme.radii.widget,
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  percentageText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: Theme.colors.background,
    borderRadius: Theme.radii.pill,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: Theme.radii.pill,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 16,
  },
  statText: {
    color: Theme.colors.textSecondary,
    fontSize: 12,
  },
  statVal: {
    color: Theme.colors.textPrimary,
    fontWeight: 'bold',
  },
  alertContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: Theme.radii.widget,
    padding: 12,
  },
  alertIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  alertText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 120,
  },
  emptyTitle: {
    color: Theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
  },
  emptySub: {
    color: Theme.colors.textSecondary,
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
});
