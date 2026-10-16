import React, { useState } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
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

// 10 subtle, high-legibility solid pastel colors for course code badges
const COURSE_PASTEL_COLORS: string[] = [
  '#97f5c9ff', // Soft Sage & Mint
  '#96daffff', // Soft Ice & Sky
  '#c6baffff', // Soft Iris & Lavender
  '#FFC583', // Soft Apricot & Peach
  '#ffe477ff', // Soft Amber
  '#ff8b99ff', // Soft Rose & Blush
  '#C7D2FE', // Soft Periwinkle
  '#99F6E4', // Soft Aqua & Teal
  '#c7fa69ff', // Soft Lime
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

  const getCardColor = (index: number): string => {
    return COURSE_PASTEL_COLORS[index % COURSE_PASTEL_COLORS.length];
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
                <View style={[styles.codeBadge, { backgroundColor: getCardColor(index) }]}>
                  <Text style={styles.courseCode}>{item.courseCode}</Text>
                </View>

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
                  <Info weight="duotone" size={15} color="#FFFFFF" />
                  <Text style={styles.actionButtonText} numberOfLines={1}>Course Info</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.marksButton]}
                  onPress={() => handleOpenMarks(item)}
                  activeOpacity={0.75}
                >
                  <ChartBar weight="duotone" size={15} color="#FFFFFF" />
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
                  <ThumbsUp weight="duotone" size={15} color="#FFFFFF" />
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
    backgroundColor: Theme.colors.surface,
    borderRadius: 24,
    padding: 16,
    marginBottom: Theme.spacing.gap,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
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
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.06)',
  },
  courseCode: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
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
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.09)',
    paddingTop: 15,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.09)', // Prominent elevated glass surface
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)', // Crisp structural border
    paddingVertical: 10,
    paddingLeft: 8, // Optical alignment: 2px less padding on leading icon side
    paddingRight: 10, // Full padding on trailing text side
    borderRadius: Theme.radii.pill,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  actionButtonDisabled: {
    opacity: 0.4,
    elevation: 0,
    shadowOpacity: 0,
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
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
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
