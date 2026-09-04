import React, { useState } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { CourseDetail } from '../services/CacheService';
import { getCourseDetailFor } from '../utils/courseCatalog';
import CourseDetailModal from './CourseDetailModal';
import CourseMarksModal from './CourseMarksModal';

export interface Course {
  courseCode: string;
  courseTitle: string;
  instructor: string;
}

interface CoursesScreenProps {
  courses: Course[];
  courseDetails?: Record<string, CourseDetail>;
  onNavigateToTab?: (tabName: string) => void;
  onOpenSrs?: (courseCode: string) => void;
}

export default function CoursesScreen({
  courses,
  courseDetails = {},
  onNavigateToTab,
  onOpenSrs,
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
    if (onOpenSrs) {
      onOpenSrs(course.courseCode);
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

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleOpenSrs(item)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="thumbs-up-outline" size={15} color={Theme.colors.textDark} />
                  <Text style={styles.actionButtonText}>SRS</Text>
                </TouchableOpacity>
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
