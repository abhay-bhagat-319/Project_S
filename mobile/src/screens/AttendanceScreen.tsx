import React, { useState } from 'react';
import {
  StyleSheet, Text, View, FlatList, RefreshControl, ScrollView,
  TouchableOpacity, Modal, SafeAreaView, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';
import { AttendanceItem, AttendanceRecord, AttendanceData } from '../services/CacheService';
import { calculateAttendance } from '../utils/AttendanceCalc';

interface AttendanceScreenProps {
  attendanceData: AttendanceData | null;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  isOffline: boolean;
}

type Filter = 'ALL' | 'PRESENT' | 'ABSENT';

export default function AttendanceScreen({ attendanceData, onRefresh, refreshing, isOffline }: AttendanceScreenProps) {
  const [selectedCourse, setSelectedCourse] = useState<AttendanceItem | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  const formattedSyncTime = () => {
    if (!attendanceData) return '';
    try {
      const date = new Date(attendanceData.timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString();
    } catch (e) { return ''; }
  };

  const getFilteredRecords = (records?: AttendanceRecord[]): AttendanceRecord[] => {
    if (!records || records.length === 0) return [];
    if (filter === 'ALL') return records;
    const isP = filter === 'PRESENT';
    return records.filter(r => {
      const s = (r.status || '').trim().toUpperCase();
      return isP ? s.startsWith('P') || s.includes('PRESENT') : s.startsWith('A') || s.includes('ABSENT');
    });
  };

  const formatDateToDDMMYYYY = (dateStr?: string): string => {
    if (!dateStr) return 'Class Session';
    const clean = dateStr.trim();

    // YYYY-MM-DD or YYYY/MM/DD
    const ymdMatch = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (ymdMatch) {
      const [, y, m, d] = ymdMatch;
      return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
    }

    // 8-digit YYYYMMDD
    const yyyymmddMatch = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (yyyymmddMatch) {
      const [, y, m, d] = yyyymmddMatch;
      return `${d}-${m}-${y}`;
    }

    // DD-MM-YYYY or DD/MM/YYYY
    const dmyMatch = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
    }

    // ISO timestamp / date string fallback
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime()) && clean.length >= 8) {
      const d = String(parsed.getDate()).padStart(2, '0');
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const y = parsed.getFullYear();
      return `${d}-${m}-${y}`;
    }

    return clean;
  };

  const renderRecordItem = ({ item }: { item: AttendanceRecord }) => {
    const s = (item.status || '').trim().toUpperCase();
    const isPresent = s.startsWith('P') || s.includes('PRESENT');

    return (
      <View style={styles.recordRow}>
        <View style={[styles.recordIndicator, { backgroundColor: isPresent ? Theme.colors.success : Theme.colors.error }]} />
        <View style={styles.recordTextContainer}>
          <Text style={styles.recordDateText}>{formatDateToDDMMYYYY(item.date)}</Text>
          <Text style={styles.recordSubText}>{isPresent ? 'Attended' : 'Missed class'}</Text>
        </View>
        <View style={[
          styles.recordBadge,
          { backgroundColor: isPresent ? 'rgba(76, 217, 100, 0.15)' : 'rgba(255, 94, 94, 0.15)' }
        ]}>
          <Text style={[styles.recordStatusText, { color: isPresent ? Theme.colors.success : Theme.colors.error }]}>
            {isPresent ? 'PRESENT' : 'ABSENT'}
          </Text>
        </View>
      </View>
    );
  };

  const renderAttendanceCard = ({ item }: { item: AttendanceItem }) => {
    const { percentage, isAbove, message, value } = calculateAttendance(item.present, item.totalClasses);
    const recordsCount = item.records ? item.records.length : 0;

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => {
          setSelectedCourse(item);
          setFilter('ALL');
        }}
        style={[styles.card, !isAbove && styles.warningCard]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.titleColumn}>
            <View style={styles.codeRow}>
              <Text style={styles.courseCode}>{item.courseCode}</Text>
              {item.instructor ? (
                <Text style={styles.instructorText} numberOfLines={1}>• {item.instructor}</Text>
              ) : null}
            </View>
            <Text style={styles.courseTitle} numberOfLines={1}>{item.courseTitle}</Text>
          </View>
          <View style={[
            styles.percentContainer,
            { borderColor: isAbove ? 'rgba(76, 217, 100, 0.3)' : 'rgba(255, 94, 94, 0.3)' }
          ]}>
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

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total</Text>
            <Text style={styles.statVal}>{item.totalClasses}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Present</Text>
            <Text style={[styles.statVal, { color: Theme.colors.success }]}>{item.present}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Absent</Text>
            <Text style={[styles.statVal, { color: Theme.colors.error }]}>{item.absent}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{isAbove ? 'Can Miss' : 'Need'}</Text>
            <Text style={[styles.statVal, { color: isAbove ? Theme.colors.lavender : Theme.colors.error }]}>
              {value} {value === 1 ? 'class' : 'classes'}
            </Text>
          </View>
        </View>

        {/* Alert Recommendation Banner */}
        <View style={[
          styles.alertContainer,
          { backgroundColor: isAbove ? 'rgba(139, 120, 255, 0.08)' : 'rgba(255, 94, 94, 0.08)' }
        ]}>
          <Ionicons
            name={isAbove ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            size={18}
            color={isAbove ? Theme.colors.primary : Theme.colors.error}
            style={styles.alertIcon}
          />
          <Text style={[styles.alertText, { color: isAbove ? Theme.colors.textPrimary : Theme.colors.error }]}>
            {message}
          </Text>
        </View>

        {/* View Details Footer */}
        <View style={styles.cardFooter}>
          <Text style={styles.cardFooterText}>
            {recordsCount > 0 ? `View ${recordsCount} class logs & history` : 'View detailed attendance metrics'}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={Theme.colors.primary} />
        </View>
      </TouchableOpacity>
    );
  };

  const selectedMetrics = selectedCourse
    ? calculateAttendance(selectedCourse.present, selectedCourse.totalClasses)
    : null;

  const recordsList = selectedCourse ? getFilteredRecords(selectedCourse.records) : [];

  return (
    <View style={styles.container}>
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Theme.colors.background} />
          <Text style={styles.bannerText}>No internet connection. Viewing offline cache.</Text>
        </View>
      )}
      {!isOffline && attendanceData && (
        <View style={styles.syncBanner}>
          <Ionicons name="sync-outline" size={14} color={Theme.colors.textSecondary} />
          <Text style={styles.syncBannerText}>Cached from {formattedSyncTime()}</Text>
        </View>
      )}

      <FlatList
        data={attendanceData?.items || []}
        keyExtractor={(item) => item.courseCode}
        renderItem={renderAttendanceCard}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Theme.colors.primary]}
            tintColor={Theme.colors.primary}
          />
        }
        ListEmptyComponent={
          <ScrollView
            contentContainerStyle={styles.emptyContainer}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            <Ionicons name="calendar-outline" size={54} color={Theme.colors.textSecondary} />
            <Text style={styles.emptyTitle}>No Attendance Data</Text>
            <Text style={styles.emptySub}>Swipe down to sync portal data.</Text>
          </ScrollView>
        }
        contentContainerStyle={styles.listContent}
      />

      {/* Date-wise Detailed Modal */}
      <Modal
        visible={!!selectedCourse}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedCourse(null)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalDismiss}
            activeOpacity={1}
            onPress={() => setSelectedCourse(null)}
          />
          <SafeAreaView style={styles.modalSheet}>
            <StatusBar barStyle="light-content" />

            {/* Handle */}
            <View style={styles.sheetHandle} />

            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetCourseCode}>{selectedCourse?.courseCode}</Text>
                <Text style={styles.sheetCourseTitle} numberOfLines={2}>{selectedCourse?.courseTitle}</Text>
                {selectedCourse?.instructor ? (
                  <Text style={styles.sheetInstructor}>Instructor: {selectedCourse.instructor}</Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => setSelectedCourse(null)} style={styles.closeBtn}>
                <Ionicons name="close-circle" size={26} color={Theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Quick Metrics Summary Bar */}
            {selectedCourse && selectedMetrics && (
              <View style={styles.modalMetricsContainer}>
                <View style={styles.metricCard}>
                  <Text style={styles.metricVal}>{selectedCourse.totalClasses}</Text>
                  <Text style={styles.metricLbl}>Classes</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={[styles.metricVal, { color: Theme.colors.success }]}>{selectedCourse.present}</Text>
                  <Text style={styles.metricLbl}>Present</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={[styles.metricVal, { color: Theme.colors.error }]}>{selectedCourse.absent}</Text>
                  <Text style={styles.metricLbl}>Absent</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={[
                    styles.metricVal,
                    { color: selectedMetrics.isAbove ? Theme.colors.success : Theme.colors.error }
                  ]}>
                    {selectedMetrics.percentage.toFixed(1)}%
                  </Text>
                  <Text style={styles.metricLbl}>Attendance</Text>
                </View>
              </View>
            )}

            {/* Strategy / Advice Box */}
            {selectedMetrics && (
              <View style={[
                styles.modalAdviceBox,
                { backgroundColor: selectedMetrics.isAbove ? 'rgba(139, 120, 255, 0.12)' : 'rgba(255, 94, 94, 0.12)' }
              ]}>
                <Ionicons
                  name={selectedMetrics.isAbove ? "shield-checkmark" : "warning"}
                  size={20}
                  color={selectedMetrics.isAbove ? Theme.colors.primary : Theme.colors.error}
                  style={{ marginRight: 10, marginTop: 2 }}
                />
                <Text style={[styles.modalAdviceText, { color: selectedMetrics.isAbove ? Theme.colors.textPrimary : Theme.colors.error }]}>
                  {selectedMetrics.message}
                </Text>
              </View>
            )}

            {/* Filter Chips */}
            <View style={styles.filterRow}>
              {(['ALL', 'PRESENT', 'ABSENT'] as Filter[]).map(f => {
                const count = f === 'ALL'
                  ? (selectedCourse?.records?.length || 0)
                  : (selectedCourse?.records || []).filter(r => {
                    const s = (r.status || '').toUpperCase();
                    return f === 'PRESENT' ? s.startsWith('P') : s.startsWith('A');
                  }).length;

                return (
                  <TouchableOpacity
                    key={f}
                    onPress={() => setFilter(f)}
                    style={[styles.chip, filter === f && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
                      {f === 'ALL' ? 'All' : f === 'PRESENT' ? 'Present' : 'Absent'} ({count})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Records List */}
            <FlatList
              data={recordsList}
              keyExtractor={(_, index) => index.toString()}
              renderItem={renderRecordItem}
              contentContainerStyle={styles.recordsListContainer}
              ListEmptyComponent={
                <View style={styles.noRecordsBox}>
                  <Ionicons name="document-text-outline" size={40} color={Theme.colors.textSecondary} />
                  <Text style={styles.noRecordsTitle}>No Session Records</Text>
                  <Text style={styles.noRecordsSub}>
                    {selectedCourse?.records && selectedCourse.records.length > 0
                      ? 'No records match the current filter.'
                      : 'Detailed date logs have not been published by the instructor yet.'}
                  </Text>
                </View>
              }
            />
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background },
  listContent: { padding: Theme.spacing.padding, paddingTop: 10, paddingBottom: 40 },

  offlineBanner: {
    backgroundColor: Theme.colors.error, flexDirection: 'row',
    justifyContent: 'center', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: Theme.spacing.padding,
  },
  bannerText: { color: Theme.colors.background, fontSize: 12, fontWeight: 'bold', marginLeft: 8 },
  syncBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  syncBannerText: { color: Theme.colors.textSecondary, fontSize: 11, marginLeft: 6 },

  // Cards
  card: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.card,
    padding: Theme.spacing.padding,
    marginBottom: Theme.spacing.gap,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  warningCard: { borderColor: Theme.colors.error, borderWidth: 1.5 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  titleColumn: { flex: 1, marginRight: 10 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  courseCode: { fontSize: 14, fontWeight: 'bold', color: Theme.colors.primary },
  instructorText: { fontSize: 12, color: Theme.colors.textSecondary, flex: 1 },
  courseTitle: { fontSize: 16, fontWeight: '700', color: Theme.colors.textPrimary, marginTop: 4 },

  percentContainer: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: Theme.radii.widget,
    backgroundColor: Theme.colors.background, borderWidth: 1, borderColor: Theme.colors.border,
  },
  percentageText: { fontSize: 16, fontWeight: 'bold' },

  progressBarBg: {
    height: 8, backgroundColor: Theme.colors.background,
    borderRadius: Theme.radii.pill, marginBottom: 16, overflow: 'hidden',
  },
  progressBarFill: { height: '100%', borderRadius: Theme.radii.pill },

  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: Theme.radii.widget,
    padding: 12,
    marginBottom: 12,
  },
  statBox: { alignItems: 'center' },
  statLabel: { color: Theme.colors.textSecondary, fontSize: 11, marginBottom: 2 },
  statVal: { color: Theme.colors.textPrimary, fontWeight: 'bold', fontSize: 14 },

  alertContainer: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: Theme.radii.widget, padding: 12,
  },
  alertIcon: { marginRight: 8 },
  alertText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '500' },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  cardFooterText: {
    fontSize: 12,
    color: Theme.colors.primary,
    fontWeight: '600',
  },

  // Empty State
  emptyContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 120 },
  emptyTitle: { color: Theme.colors.textPrimary, fontSize: 18, fontWeight: 'bold', marginTop: 16 },
  emptySub: { color: Theme.colors.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center' },

  // Bottom Sheet Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  modalDismiss: { flex: 1 },
  modalSheet: {
    backgroundColor: Theme.colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    maxHeight: '85%', minHeight: '60%',
    paddingBottom: 20,
  },
  sheetHandle: {
    width: 44, height: 5, borderRadius: 3,
    backgroundColor: Theme.colors.border,
    alignSelf: 'center', marginTop: 10, marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Theme.colors.border,
  },
  sheetCourseCode: { fontSize: 13, fontWeight: 'bold', color: Theme.colors.primary, marginBottom: 2 },
  sheetCourseTitle: { fontSize: 17, fontWeight: '700', color: Theme.colors.textPrimary },
  sheetInstructor: { fontSize: 12, color: Theme.colors.textSecondary, marginTop: 4 },
  closeBtn: { padding: 4, marginLeft: 12 },

  // Modal Metrics
  modalMetricsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Theme.colors.background,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: Theme.radii.widget,
  },
  metricCard: { alignItems: 'center' },
  metricVal: { fontSize: 16, fontWeight: 'bold', color: Theme.colors.textPrimary },
  metricLbl: { fontSize: 11, color: Theme.colors.textSecondary, marginTop: 2 },

  modalAdviceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: Theme.radii.widget,
    padding: 12,
  },
  modalAdviceText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '500' },

  // Filter Chips
  filterRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 8,
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: Theme.radii.pill, borderWidth: 1,
    borderColor: Theme.colors.border, backgroundColor: Theme.colors.background,
  },
  chipActive: { backgroundColor: Theme.colors.primary, borderColor: Theme.colors.primary },
  chipText: { fontSize: 12, color: Theme.colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  // Records List
  recordsListContainer: { paddingHorizontal: 16, paddingBottom: 20 },
  recordRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  recordIndicator: { width: 8, height: 8, borderRadius: 4, marginRight: 12 },
  recordTextContainer: { flex: 1 },
  recordDateText: { fontSize: 14, color: Theme.colors.textPrimary, fontWeight: '600' },
  recordSubText: { fontSize: 11, color: Theme.colors.textSecondary, marginTop: 2 },
  recordBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Theme.radii.pill },
  recordStatusText: { fontSize: 11, fontWeight: '700' },

  noRecordsBox: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  noRecordsTitle: { color: Theme.colors.textPrimary, fontSize: 15, fontWeight: 'bold', marginTop: 12 },
  noRecordsSub: { color: Theme.colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'center', lineHeight: 16 },
});
