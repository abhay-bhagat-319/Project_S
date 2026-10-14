import React, { useState } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { UserCircle, Info, ChartBar, ThumbsUp, BookOpen } from 'phosphor-react-native';
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

// 10 distinct vibrant gradient pairings for the card's framing header
const COURSE_GRADIENTS: [string, string][] = [
  ['#B4F857', '#F6FC62'], // Lime Lemon (exact match to reference)
  ['#38EF7D', '#11998E'], // Electric Emerald
  ['#00F2FE', '#4FACFE'], // Cyan Aqua
  ['#C084FC', '#818CF8'], // Neon Violet & Indigo
  ['#FF9966', '#FF5E62'], // Sunset Coral
  ['#FBBF24', '#F472B6'], // Golden Amber to Pink
  ['#6EE7B7', '#3B82F6'], // Mint Seafoam to Electric Blue
  ['#FDA4AF', '#F43F5E'], // Flamingo Rose
  ['#93C5FD', '#C4B5FD'], // Ice Sky to Periwinkle
  ['#5EEAD4', '#60A5FA'], // Turquoise to Ocean
];

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

  const getCardGradient = (index: number): [string, string] => {
    return COURSE_GRADIENTS[index % COURSE_GRADIENTS.length];
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
            <View style={styles.courseCard}>
              {/* Bento Card Header: Vibrant Code Badge on Left, Glass Chips on Right */}
              <View style={styles.cardHeader}>
                <LinearGradient
                  colors={getCardGradient(index)}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.codeBadge}
                >
                  <Text style={styles.courseCode}>{item.courseCode}</Text>
                </LinearGradient>

                <View style={styles.headerRightBadges}>
                  {detail.slot && detail.slot !== 'N/A' ? (
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>Slot {detail.slot}</Text>
                    </View>
                  ) : null}
                  {detail.credits ? (
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>{detail.credits} Cr</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Title & Instructor */}
              <Text style={styles.courseTitle}>{item.courseTitle}</Text>
              <View style={styles.instructorRow}>
                <UserCircle weight="duotone" size={15} color="rgba(255, 255, 255, 0.65)" />
                <Text style={styles.instructorText} numberOfLines={1}>
                  {item.instructor || 'Instructor Not Assigned'}
                </Text>
              </View>

              {/* Action Buttons Row - Single Line */}
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.infoButton]}
                  onPress={() => handleOpenInfo(item)}
                  activeOpacity={0.75}
                >
                  <Info weight="duotone" size={14} color="#FFFFFF" />
                  <Text style={styles.actionButtonText} numberOfLines={1}>Course Info</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.marksButton]}
                  onPress={() => handleOpenMarks(item)}
                  activeOpacity={0.75}
                >
                  <ChartBar weight="duotone" size={14} color="#FFFFFF" />
                  <Text style={styles.actionButtonText} numberOfLines={1}>Marks</Text>
                </TouchableOpacity>

                {/* SRS Action Button */}
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    styles.srsButton,
                    !onOpenSrs && styles.actionButtonDisabled,
                  ]}
                  onPress={onOpenSrs ? () => onOpenSrs(item.courseCode) : undefined}
                  disabled={!onOpenSrs}
                  activeOpacity={0.75}
                >
                  <ThumbsUp weight="duotone" size={14} color="#FFFFFF" />
                  <Text style={styles.actionButtonText} numberOfLines={1}>SRS</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <BookOpen weight="duotone" size={48} color={Theme.colors.textSecondary} />
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
    backgroundColor: '#23252E',
    borderRadius: 24,
    padding: 16,
    marginBottom: Theme.spacing.gap,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  codeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5.5,
    borderRadius: Theme.radii.pill,
    alignSelf: 'flex-start',
  },
  courseCode: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: 0.5,
  },
  headerRightBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaChip: {
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: Theme.radii.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  metaChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.82)',
    letterSpacing: 0.2,
  },
  courseTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 5,
    lineHeight: 24,
  },
  instructorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  instructorText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.65)', // Improved contrast & readability
    marginLeft: 6,
    flex: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 14,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26, 28, 35, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 9, // Increased vertical breathing room
    paddingLeft: 6, // Optical alignment: 2px less padding on leading icon side
    paddingRight: 8, // Full padding on trailing text side
    borderRadius: Theme.radii.pill,
    gap: 5,
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  infoButton: {
    flex: 1.3,
  },
  marksButton: {
    flex: 0.92,
  },
  srsButton: {
    flex: 0.78,
  },
  actionButtonText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.1,
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
