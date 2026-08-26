import React, { useState } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, Modal, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';

export interface Course {
  courseCode: string;
  courseTitle: string;
  instructor: string;
}

interface CoursesScreenProps {
  courses: Course[];
  onNavigateToTab: (tabName: string) => void;
}

export default function CoursesScreen({ courses, onNavigateToTab }: CoursesScreenProps) {
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  const handleOpenSheet = (course: Course) => {
    setSelectedCourse(course);
    setSheetVisible(true);
  };

  const handleAction = (type: 'performance' | 'attendance' | 'info' | 'timeline') => {
    setSheetVisible(false);
    if (!selectedCourse) return;

    switch (type) {
      case 'attendance':
        // Navigate to the Standalone Attendance tab
        onNavigateToTab('Attendance');
        break;
      case 'info':
        setInfoModalVisible(true);
        break;
      case 'timeline':
        const url = `https://shiksha.iiserb.ac.in/secure/facultyTimeline/${selectedCourse.courseCode}&2026-2027-1`;
        Linking.openURL(url).catch(() => {
          Alert.alert('Error', 'Unable to open course timeline link.');
        });
        break;
      case 'performance':
        Alert.alert(
          'Spreadsheet Performance',
          `Viewing grades and performance spreadsheet for ${selectedCourse.courseCode}.\n\n(Feature redirects to portal spreadsheet data)`
        );
        break;
    }
  };

  // Determine card background color based on index
  const getCardColor = (index: number) => {
    const colors = [Theme.colors.lavender, Theme.colors.pink, Theme.colors.mint];
    return colors[index % colors.length];
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={courses}
        keyExtractor={(item) => item.courseCode}
        renderItem={({ item, index }) => (
          <TouchableOpacity 
            style={[styles.courseCard, { backgroundColor: getCardColor(index) }]}
            onPress={() => handleOpenSheet(item)}
            activeOpacity={0.8}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.courseCode}>{item.courseCode}</Text>
              <Ionicons name="ellipsis-vertical" size={20} color={Theme.colors.textDark} />
            </View>
            <Text style={styles.courseTitle}>{item.courseTitle}</Text>
            <View style={styles.instructorRow}>
              <Ionicons name="person-circle-outline" size={16} color={Theme.colors.textDark} />
              <Text style={styles.instructorText}>{item.instructor}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="book-outline" size={48} color={Theme.colors.textSecondary} />
            <Text style={styles.emptyText}>No registered courses cached.</Text>
            <Text style={styles.emptySubtext}>Sync your data on the attendance screen.</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />

      {/* Course Actions Bottom Sheet */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={sheetVisible}
        onRequestClose={() => setSheetVisible(false)}
      >
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.flexDismiss} onPress={() => setSheetVisible(false)} />
          <View style={styles.sheetContent}>
            <View style={styles.sheetHeader}>
              <View style={styles.dragIndicator} />
              <Text style={styles.sheetTitle}>{selectedCourse?.courseCode} - Action List</Text>
              <Text style={styles.sheetSubtitle}>{selectedCourse?.courseTitle}</Text>
            </View>

            <TouchableOpacity style={styles.actionItem} onPress={() => handleAction('attendance')}>
              <Ionicons name="people" size={22} color={Theme.colors.primary} />
              <Text style={styles.actionText}>Check Detailed Attendance</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem} onPress={() => handleAction('info')}>
              <Ionicons name="information-circle-outline" size={22} color={Theme.colors.primary} />
              <Text style={styles.actionText}>View Course Specification</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem} onPress={() => handleAction('timeline')}>
              <Ionicons name="git-commit-outline" size={22} color={Theme.colors.primary} />
              <Text style={styles.actionText}>Course Timeline / Progress</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem} onPress={() => handleAction('performance')}>
              <Ionicons name="trending-up-outline" size={22} color={Theme.colors.primary} />
              <Text style={styles.actionText}>Academic spreadsheet grades</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Course Info Detail Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={infoModalVisible}
        onRequestClose={() => setInfoModalVisible(false)}
      >
        <View style={styles.overlayBackdrop}>
          <View style={styles.infoModal}>
            <View style={styles.infoModalHeader}>
              <Text style={styles.infoModalTitle}>Course Details</Text>
              <TouchableOpacity onPress={() => setInfoModalVisible(false)}>
                <Ionicons name="close" size={22} color={Theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Code:</Text>
              <Text style={styles.infoValue}>{selectedCourse?.courseCode}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Title:</Text>
              <Text style={styles.infoValue}>{selectedCourse?.courseTitle}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Instructor:</Text>
              <Text style={styles.infoValue}>{selectedCourse?.instructor}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Academic Year:</Text>
              <Text style={styles.infoValue}>2026-2027</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Semester Status:</Text>
              <Text style={styles.infoValue}>Active Registration</Text>
            </View>

            <TouchableOpacity style={styles.okBtn} onPress={() => setInfoModalVisible(false)}>
              <Text style={styles.okBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 30,
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
  courseCode: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Theme.colors.textDark,
  },
  courseTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.textDark,
    marginTop: 8,
    marginBottom: 16,
  },
  instructorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  instructorText: {
    fontSize: 12,
    fontWeight: '500',
    color: Theme.colors.textDark,
    marginLeft: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
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
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  flexDismiss: {
    flex: 1,
  },
  sheetContent: {
    backgroundColor: Theme.colors.surface,
    borderTopLeftRadius: Theme.radii.card,
    borderTopRightRadius: Theme.radii.card,
    padding: Theme.spacing.padding,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
  },
  sheetHeader: {
    alignItems: 'center',
    marginBottom: Theme.spacing.gap * 1.5,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.colors.border,
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  sheetSubtitle: {
    fontSize: 13,
    color: Theme.colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  actionText: {
    fontSize: 15,
    color: Theme.colors.textPrimary,
    marginLeft: 16,
    fontWeight: '500',
  },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.padding,
  },
  infoModal: {
    backgroundColor: Theme.colors.surface,
    width: '100%',
    borderRadius: Theme.radii.card,
    padding: Theme.spacing.padding,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  infoModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.gap * 1.5,
  },
  infoModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  infoLabel: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
  },
  infoValue: {
    color: Theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  okBtn: {
    backgroundColor: Theme.colors.primary,
    height: 48,
    borderRadius: Theme.radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  okBtnText: {
    color: Theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },
});
