import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { ChartBar, X, Wrench, ChartPieSlice } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { CacheService, CourseMarksData } from '../services/CacheService';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface CourseMarksModalProps {
  visible: boolean;
  courseCode: string;
  courseTitle: string;
  onClose: () => void;
  onRefreshMarks?: (courseCode: string) => Promise<CourseMarksData | void>;
}

export default function CourseMarksModal({
  visible,
  courseCode,
  courseTitle,
  onClose,
}: CourseMarksModalProps) {
  const insets = useSafeAreaInsets();
  const [internalVisible, setInternalVisible] = useState(visible);
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible && courseCode) {
      setInternalVisible(true);
      backdropAnim.setValue(0);
      slideAnim.setValue(SCREEN_HEIGHT);
      Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 28,
          stiffness: 260,
          mass: 0.8,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!visible && internalVisible) {
      handleDismiss();
    }
  }, [visible, courseCode]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setInternalVisible(false);
      onClose();
    });
  };

  if (!courseCode || !internalVisible) return null;

  return (
    <Modal
      visible={internalVisible}
      animationType="none"
      transparent={true}
      onRequestClose={handleDismiss}
      statusBarTranslucent={true}
    >
      <View style={styles.modalOverlay}>
        {/* Animated Backdrop: Fades In / Out smoothly on the spot */}
        <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
          <TouchableOpacity
            style={styles.modalDismiss}
            activeOpacity={1}
            onPress={handleDismiss}
          />
        </Animated.View>

        {/* Animated Modal Sheet: Slides up from bottom */}
        <Animated.View
          style={[
            styles.modalContainer,
            {
              paddingBottom: Math.max(24, insets.bottom + 16),
              transform: [{ translateY: slideAnim }],
            }
          ]}
        >
          {/* Top Drag Handle */}
          <View style={styles.sheetHandle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconBadge}>
                <ChartBar weight="duotone" size={20} color={Theme.colors.primary} />
              </View>
              <View>
                <Text style={styles.courseCodeText}>{courseCode}</Text>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  Course Evaluation & Marks
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={handleDismiss} activeOpacity={0.7}>
              <X weight="bold" size={18} color={Theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Course Title Preview */}
          <Text style={styles.courseTitleText}>{courseTitle}</Text>

          {/* Work in Progress Card */}
          <View style={styles.placeholderCard}>
            <View style={styles.wipBadge}>
              <Wrench weight="duotone" size={14} color="#fef08a" style={{ marginRight: 5 }} />
              <Text style={styles.wipBadgeText}>Work in Progress</Text>
            </View>

            <ChartPieSlice weight="duotone" size={44} color={Theme.colors.primary} style={{ marginVertical: 12 }} />

            <Text style={styles.placeholderTitle}>Assessment Breakdown</Text>
            <Text style={styles.placeholderSubtitle}>
              Detailed test scores, mid-sem/end-sem evaluation components, and weightages for {courseCode} are actively being developed for a future release.
            </Text>
          </View>

          {/* Dismiss Action Button */}
          <TouchableOpacity style={styles.actionBtn} onPress={handleDismiss} activeOpacity={0.8}>
            <Text style={styles.actionBtnText}>Got It</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  modalDismiss: {
    flex: 1,
  },
  modalContainer: {
    width: '100%',
    maxHeight: '85%',
    backgroundColor: Theme.colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: Theme.spacing.padding,
    paddingTop: 10,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Theme.colors.border,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Theme.colors.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
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
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
    marginBottom: 14,
  },
  scrollList: {
    maxHeight: 340,
    marginBottom: 14,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  componentsCard: {
    backgroundColor: Theme.colors.background,
    borderRadius: Theme.radii.widget,
    padding: 14,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  componentsCardTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  lastUpdatedText: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
  },
  componentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  componentRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  componentLeft: {
    flex: 1,
    marginRight: 10,
  },
  componentName: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
    marginBottom: 2,
  },
  componentWeightage: {
    fontSize: 12,
    color: Theme.colors.lavender,
  },
  componentRight: {
    alignItems: 'flex-end',
  },
  componentScore: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
    marginBottom: 2,
  },
  scorePill: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  scorePillText: {
    fontSize: 10,
    color: Theme.colors.textSecondary,
    fontWeight: '600',
  },
  placeholderCard: {
    backgroundColor: Theme.colors.background,
    borderRadius: Theme.radii.widget,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: 16,
  },
  placeholderTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    marginTop: 10,
    marginBottom: 4,
  },
  placeholderSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  fetchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Theme.radii.pill,
  },
  fetchBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139, 120, 255, 0.25)',
    borderWidth: 1,
    borderColor: Theme.colors.primary,
    borderRadius: Theme.radii.pill,
    paddingVertical: 10,
  },
  refreshBtnText: {
    color: Theme.colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  wipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(234, 179, 8, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 4,
  },
  wipBadgeText: {
    color: '#fef08a',
    fontSize: 12,
    fontWeight: '700',
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
