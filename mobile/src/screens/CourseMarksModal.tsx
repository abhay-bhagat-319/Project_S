import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';

interface CourseMarksModalProps {
  visible: boolean;
  courseCode: string;
  courseTitle: string;
  onClose: () => void;
}

export default function CourseMarksModal({
  visible,
  courseCode,
  courseTitle,
  onClose,
}: CourseMarksModalProps) {
  if (!courseCode) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modalContainer}>
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <View style={styles.iconBadge}>
                    <Ionicons name="bar-chart" size={20} color={Theme.colors.primary} />
                  </View>
                  <View>
                    <Text style={styles.courseCodeText}>{courseCode}</Text>
                    <Text style={styles.modalTitle} numberOfLines={1}>
                      Course Performance
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
                  <Ionicons name="close" size={18} color={Theme.colors.textPrimary} />
                </TouchableOpacity>
              </View>

              {/* Course Title Preview */}
              <Text style={styles.courseTitleText}>{courseTitle}</Text>

              {/* Placeholder Card */}
              <View style={styles.placeholderCard}>
                <Ionicons name="construct-outline" size={36} color={Theme.colors.lavender} />
                <Text style={styles.placeholderTitle}>Performance Data Coming Soon</Text>
                <Text style={styles.placeholderSubtitle}>
                  We are finalizing the spreadsheet parser to bring you quiz, mid-sem, and lab grade breakdowns directly within the app.
                </Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>Under Development</Text>
                </View>
              </View>

              {/* Dismiss Action Button */}
              <TouchableOpacity style={styles.actionBtn} onPress={onClose} activeOpacity={0.8}>
                <Text style={styles.actionBtnText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.padding,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.card,
    padding: 20,
    borderWidth: 1,
    borderColor: Theme.colors.border,
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
    gap: 10,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(139, 120, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  courseCodeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.primary,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  courseTitleText: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
    marginBottom: 16,
  },
  placeholderCard: {
    backgroundColor: Theme.colors.background,
    borderRadius: Theme.radii.widget,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: 20,
  },
  placeholderTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    marginTop: 12,
    marginBottom: 6,
  },
  placeholderSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 14,
  },
  statusBadge: {
    backgroundColor: 'rgba(226, 220, 255, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Theme.radii.pill,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.lavender,
  },
  actionBtn: {
    backgroundColor: Theme.colors.primary,
    borderRadius: Theme.radii.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
