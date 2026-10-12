import React, { useState } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { CourseDetail, CourseSRSStatus, Course } from '../services/CacheService';
import { getCourseDetailFor } from '../utils/courseCatalog';
import CourseDetailModal from './CourseDetailModal';
import CourseMarksModal from './CourseMarksModal';
export { Course };

interface CoursesScreenProps {
  courses: Course[];
  courseDetails?: Record<string, CourseDetail>;
  onNavigateToTab?: (tabName: string) => void;
  onOpenSrs?: (courseCode: string) => void;
  onRefresh?: () => Promise<void>;
  refreshing?: boolean;
  onRefreshMarks?: (courseCode: string) => Promise<any>;
}

export default function CoursesScreen({
  courses,
  courseDetails = {},
  onNavigateToTab,
  onOpenSrs,
  onRefresh,
  refreshing = false,
  onRefreshMarks,
}: CoursesScreenProps) {
  const insets = useSafeAreaInsets();
  const [selectedDetail, setSelectedDetail] = useState<CourseDetail | null>(null);
  const [marksModalCourse, setMarksModalCourse] = useState<Course | null>(null);

  // Determine card background color based on index
  const getCardColor = (index: number) => {
    const colors = [Theme.colors.lavender, Theme.colors.pink, Theme.colors.mint];
    return colors[index % colors.length];
  };

  const handleOpenInfo = (course: Course) => {
    const detail = getCourseDetailFor(
      course.courseCode,
      course.courseTitle,
      course.instructor,
      courseDetails
    );
    setSelectedDetail(detail);
  };

  const handleOpenMarks = (course: Course) => {
    setMarksModalCourse(course);
  };

  const handleOpenSrs = (course: Course) => {
    const isAvailable = !!(course.srsStatus?.midSemAvailable || course.srsStatus?.endSemAvailable);
    if (isAvailable) {
      if (onOpenSrs) {
        onOpenSrs(course.courseCode);
      }
    } else {
      Alert.alert(
        'SRS Unavailable',
        `Student Reaction Survey is currently closed on the portal for ${course.courseCode} (${course.courseTitle}).`,
        [
          { text: 'OK', style: 'cancel' },
          {
            text: 'Open Portal',
            onPress: () => {
              if (onOpenSrs) onOpenSrs(course.courseCode);
            },
          },
        ]
      );
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={courses}
        keyExtractor={(item) => item.courseCode}
        renderItem={({ item, index }) => {
          const detail = getCourseDetailFor(
            item.courseCode,
            item.courseTitle,
            item.instructor,
            courseDetails
          );

          return (
            <View style={[styles.courseCard, { backgroundColor: getCardColor(index) }]}>
              {/* Card Header: Code, Slot, Enrolled Tag */}
              <View style={styles.cardHeader}>
                <View style={styles.headerLeftBadges}>
                  <Text style={styles.courseCode}>{item.courseCode}</Text>
                  {detail.slot && detail.slot !== 'N/A' ? (
                    <View style={styles.slotBadge}>
                      <Text style={styles.slotBadgeText}>Slot {detail.slot}</Text>
                    </View>
                  ) : null}
                  {detail.credits ? (
                    <View style={styles.creditsBadge}>
                      <Text style={styles.creditsBadgeText}>{detail.credits} Cr</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.enrolledBadge}>
                  <Text style={styles.enrolledBadgeText}>Enrolled</Text>
                </View>
              </View>

              {/* Title & Instructor */}
              <Text style={styles.courseTitle}>{item.courseTitle}</Text>
              <View style={styles.instructorRow}>
                <Ionicons name="person-circle-outline" size={18} color={Theme.colors.textDark} />
                <Text style={styles.instructorText} numberOfLines={1}>
                  {item.instructor || 'Instructor Not Assigned'}
                </Text>
              </View>

              {/* Action Buttons Row */}
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleOpenInfo(item)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="information-circle-outline" size={15} color={Theme.colors.textDark} />
                  <Text style={styles.actionButtonText}>Course Info</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleOpenMarks(item)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="bar-chart-outline" size={15} color={Theme.colors.textDark} />
                  <Text style={styles.actionButtonText}>Marks</Text>
                </TouchableOpacity>

                {/* SRS Action Button */}
                {(() => {
                  const isMid = !!item.srsStatus?.midSemAvailable;
                  const isEnd = !!item.srsStatus?.endSemAvailable;

                  let btnStyle: any = styles.actionButton;
                  let textStyle: any = styles.actionButtonText;
                  let iconName: any = "thumbs-up-outline";
                  let iconColor = Theme.colors.textDark;
                  let label = "SRS";

                  if (isMid) {
                    btnStyle = [styles.actionButton, styles.srsButtonMidActive];
                    textStyle = styles.srsTextMidActive;
                    iconName = "thumbs-up";
                    iconColor = "#D84315";
                    label = "Mid SRS";
                  } else if (isEnd) {
                    btnStyle = [styles.actionButton, styles.srsButtonEndActive];
                    textStyle = styles.srsTextEndActive;
                    iconName = "thumbs-up";
                    iconColor = "#E65100";
                    label = "End SRS";
                  }

                  return (
                    <TouchableOpacity
                      style={btnStyle}
                      onPress={() => handleOpenSrs(item)}
                      activeOpacity={0.75}
                    >
                      {(isMid || isEnd) && <View style={styles.activePulseDot} />}
                      <Ionicons name={iconName} size={15} color={iconColor} />
                      <Text style={textStyle}>{label}</Text>
                    </TouchableOpacity>
                  );
                })()}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="book-outline" size={48} color={Theme.colors.textSecondary} />
            <Text style={styles.emptyText}>No registered courses cached.</Text>
            <Text style={styles.emptySubtext}>
              Swipe down on the Attendance screen to sync your portal data.
            </Text>
          </View>
        }
        contentContainerStyle={[
          styles.listContent, 
          { paddingBottom: Theme.layout.baseScrollBottomPadding + insets.bottom }
        ]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Theme.colors.primary}
              colors={[Theme.colors.primary]}
              progressBackgroundColor={Theme.colors.surface}
            />
          ) : undefined
        }
      />

      {/* Course Details Modal */}
      <CourseDetailModal
        visible={!!selectedDetail}
        courseDetail={selectedDetail}
        onClose={() => setSelectedDetail(null)}
      />

      {/* Course Marks Modal */}
      <CourseMarksModal
        visible={!!marksModalCourse}
        courseCode={marksModalCourse?.courseCode || ''}
        courseTitle={marksModalCourse?.courseTitle || ''}
        onClose={() => setMarksModalCourse(null)}
        onRefreshMarks={onRefreshMarks}
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
    paddingBottom: 96,
  },
  courseCard: {
    borderRadius: Theme.radii.card,
    padding: Theme.spacing.padding,
    marginBottom: Theme.spacing.gap,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeftBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  courseCode: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Theme.colors.textDark,
  },
  slotBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Theme.radii.pill,
    backgroundColor: 'rgba(26, 28, 35, 0.08)',
  },
  slotBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.textDark,
  },
  creditsBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Theme.radii.pill,
    backgroundColor: 'rgba(26, 28, 35, 0.08)',
  },
  creditsBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.textDark,
  },
  enrolledBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Theme.radii.pill,
    backgroundColor: 'rgba(26, 28, 35, 0.12)',
  },
  enrolledBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.textDark,
  },
  courseTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.textDark,
    marginTop: 8,
    marginBottom: 6,
  },
  instructorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  instructorText: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.textDark,
    marginLeft: 6,
    flex: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(26, 28, 35, 0.1)',
    paddingTop: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26, 28, 35, 0.08)',
    paddingVertical: 8,
    borderRadius: Theme.radii.pill,
    gap: 4,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.textDark,
  },
  srsButtonMidActive: {
    backgroundColor: '#FFEBE6',
    borderWidth: 1.5,
    borderColor: '#FF5722',
    position: 'relative',
  },
  srsButtonEndActive: {
    backgroundColor: '#FFF3E0',
    borderWidth: 1.5,
    borderColor: '#FF9800',
    position: 'relative',
  },
  srsButtonSubmitted: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#81C784',
  },
  srsTextMidActive: {
    fontSize: 12,
    fontWeight: '800',
    color: '#D84315',
  },
  srsTextEndActive: {
    fontSize: 12,
    fontWeight: '800',
    color: '#E65100',
  },
  srsTextSubmitted: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.successGreen,
  },
  activePulseDot: {
    position: 'absolute',
    top: 4,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF3D00',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 100,
  },
  emptyText: {
    color: Theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 16,
  },
  emptySubtext: {
    color: Theme.colors.textSecondary,
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
});
