import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';
import { CourseDetail } from '../services/CacheService';

interface CourseDetailModalProps {
  visible: boolean;
  courseDetail: CourseDetail | null;
  onClose: () => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function CourseDetailModal({
  visible,
  courseDetail,
  onClose,
}: CourseDetailModalProps) {
  if (!courseDetail) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <View style={styles.modalOverlay}>
        {/* Backdrop touch to dismiss */}
        <Pressable style={styles.backdropPressable} onPress={onClose} />

        {/* Modal Sheet Container */}
        <View style={styles.modalContainer}>
          {/* Top Drag Handle */}
          <View style={styles.dragHandleWrapper}>
            <View style={styles.dragIndicator} />
          </View>

          {/* Modal Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <View style={styles.badgeRow}>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeBadgeText}>{courseDetail.courseCode}</Text>
                </View>
                {courseDetail.credits ? (
                  <View style={styles.metaBadge}>
                    <Ionicons name="ribbon-outline" size={12} color={Theme.colors.primary} />
                    <Text style={styles.metaBadgeText}>{courseDetail.credits} Credits</Text>
                  </View>
                ) : null}
                {courseDetail.slot && courseDetail.slot !== 'N/A' ? (
                  <View style={styles.metaBadge}>
                    <Ionicons name="time-outline" size={12} color={Theme.colors.lavender} />
                    <Text style={styles.metaBadgeText}>Slot {courseDetail.slot}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.titleText}>{courseDetail.courseTitle}</Text>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={Theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Modal Content Scroll Area */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
            bounces={true}
          >
            {/* Faculty & Staff Section */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="people-outline" size={18} color={Theme.colors.primary} />
                <Text style={styles.sectionTitle}>Instructional Staff</Text>
              </View>

              <View style={styles.staffRow}>
                <Text style={styles.staffLabel}>Instructor(s):</Text>
                <Text style={styles.staffValue}>{courseDetail.instructors || 'Not Assigned'}</Text>
              </View>

              {courseDetail.tutors ? (
                <View style={styles.staffRow}>
                  <Text style={styles.staffLabel}>Tutor(s):</Text>
                  <Text style={styles.staffValue}>{courseDetail.tutors}</Text>
                </View>
              ) : null}

              {courseDetail.teachingAssistants ? (
                <View style={styles.staffRow}>
                  <Text style={styles.staffLabel}>Teaching Assistants:</Text>
                  <Text style={styles.staffValue}>{courseDetail.teachingAssistants}</Text>
                </View>
              ) : null}
            </View>

            {/* Prerequisites Section */}
            {courseDetail.prerequisites || courseDetail.otherPrerequisites ? (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="git-branch-outline" size={18} color={Theme.colors.lavender} />
                  <Text style={styles.sectionTitle}>Prerequisites</Text>
                </View>
                {courseDetail.prerequisites ? (
                  <Text style={styles.bodyText}>{courseDetail.prerequisites}</Text>
                ) : null}
                {courseDetail.otherPrerequisites ? (
                  <Text style={[styles.bodyText, { marginTop: 6 }]}>
                    {courseDetail.otherPrerequisites}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Learning Objectives Section */}
            {courseDetail.learningObjectives && courseDetail.learningObjectives.length > 0 ? (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="checkbox-outline" size={18} color={Theme.colors.mint} />
                  <Text style={styles.sectionTitle}>Learning Objectives</Text>
                </View>
                {courseDetail.learningObjectives.map((obj, idx) => (
                  <View key={`obj-${idx}`} style={styles.bulletItem}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.bulletText}>{obj}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Syllabus / Course Content Section */}
            {courseDetail.content ? (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="document-text-outline" size={18} color={Theme.colors.pink} />
                  <Text style={styles.sectionTitle}>Course Syllabus & Content</Text>
                </View>
                <Text style={styles.bodyText}>{courseDetail.content}</Text>
              </View>
            ) : null}

            {/* Textbooks & References Section */}
            {courseDetail.textBooks && courseDetail.textBooks.length > 0 ? (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="library-outline" size={18} color={Theme.colors.lavender} />
                  <Text style={styles.sectionTitle}>Prescribed Textbooks</Text>
                </View>
                {courseDetail.textBooks.map((book, idx) => (
                  <View key={`tb-${idx}`} style={styles.bookItem}>
                    <Ionicons name="book-outline" size={15} color={Theme.colors.primary} style={{ marginTop: 2, marginRight: 8 }} />
                    <Text style={styles.bookText}>{book}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {courseDetail.referenceBooks && courseDetail.referenceBooks.length > 0 ? (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="bookmarks-outline" size={18} color={Theme.colors.lavender} />
                  <Text style={styles.sectionTitle}>Reference Books</Text>
                </View>
                {courseDetail.referenceBooks.map((refBook, idx) => (
                  <View key={`rb-${idx}`} style={styles.bookItem}>
                    <Ionicons name="bookmark-outline" size={15} color={Theme.colors.textSecondary} style={{ marginTop: 2, marginRight: 8 }} />
                    <Text style={styles.bookText}>{refBook}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Remarks (if present) */}
            {courseDetail.remark ? (
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="information-circle-outline" size={18} color={Theme.colors.textSecondary} />
                  <Text style={styles.sectionTitle}>Remarks</Text>
                </View>
                <Text style={styles.bodyText}>{courseDetail.remark}</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  backdropPressable: {
    flex: 1,
  },
  modalContainer: {
    width: '100%',
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: Theme.radii.card,
    borderTopRightRadius: Theme.radii.card,
    maxHeight: SCREEN_HEIGHT * 0.85,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Theme.colors.border,
    paddingTop: 4,
  },
  dragHandleWrapper: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragIndicator: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.padding,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  headerTitleContainer: {
    flex: 1,
    paddingRight: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    flexWrap: 'wrap',
    gap: 6,
  },
  codeBadge: {
    backgroundColor: Theme.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Theme.radii.pill,
  },
  codeBadgeText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Theme.radii.pill,
    gap: 4,
  },
  metaBadgeText: {
    color: Theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '600',
  },
  titleText: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
    lineHeight: 23,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollArea: {
    flexGrow: 1,
  },
  scrollContent: {
    padding: Theme.spacing.padding,
    paddingBottom: 56,
    gap: 12,
  },
  sectionCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.widget,
    padding: 16,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  staffRow: {
    marginBottom: 6,
  },
  staffLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
  },
  staffValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
    marginTop: 2,
  },
  bodyText: {
    fontSize: 13.5,
    lineHeight: 20,
    color: Theme.colors.textPrimary,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Theme.colors.primary,
    marginTop: 7,
    marginRight: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: Theme.colors.textPrimary,
  },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  bookText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: Theme.colors.textPrimary,
  },
});
