import React from 'react';
import { StyleSheet, Text, View, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';

export interface Course {
  courseCode: string;
  courseTitle: string;
  instructor: string;
}

interface CoursesScreenProps {
  courses: Course[];
  onNavigateToTab?: (tabName: string) => void;
}

export default function CoursesScreen({ courses }: CoursesScreenProps) {
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
          <View style={[styles.courseCard, { backgroundColor: getCardColor(index) }]}>
            <View style={styles.cardHeader}>
              <Text style={styles.courseCode}>{item.courseCode}</Text>
              <View style={styles.enrolledBadge}>
                <Text style={styles.enrolledBadgeText}>Enrolled</Text>
              </View>
            </View>
            <Text style={styles.courseTitle}>{item.courseTitle}</Text>
            <View style={styles.instructorRow}>
              <Ionicons name="person-circle-outline" size={18} color={Theme.colors.textDark} />
              <Text style={styles.instructorText}>{item.instructor || 'Instructor Not Assigned'}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="book-outline" size={48} color={Theme.colors.textSecondary} />
            <Text style={styles.emptyText}>No registered courses cached.</Text>
            <Text style={styles.emptySubtext}>Swipe down on the Attendance screen to sync portal data.</Text>
          </View>
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
    paddingBottom: 40,
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
    marginBottom: 16,
  },
  instructorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  instructorText: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.textDark,
    marginLeft: 6,
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
