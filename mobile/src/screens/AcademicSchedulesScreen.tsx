import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import {
  AcademicDocsService,
  AcademicDoc,
  DocCategory,
} from '../services/AcademicDocsService';

interface AcademicSchedulesScreenProps {
  onBack: () => void;
}

type FilterCategory = 'ALL' | DocCategory;

const CATEGORY_TABS: { key: FilterCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'ALL', label: 'All', icon: 'documents-outline' },
  { key: 'CALENDAR', label: 'Calendars', icon: 'calendar-outline' },
  { key: 'TIMETABLE', label: 'Timetable', icon: 'time-outline' },
  { key: 'EXAM', label: 'Exams', icon: 'newspaper-outline' },
  { key: 'HOLIDAYS', label: 'Holidays', icon: 'sunny-outline' },
];

export default function AcademicSchedulesScreen({ onBack }: AcademicSchedulesScreenProps) {
  const insets = useSafeAreaInsets();
  const [docs, setDocs] = useState<AcademicDoc[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [activeOpeningId, setActiveOpeningId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  const loadDocs = useCallback(async () => {
    try {
      const items = await AcademicDocsService.getAcademicDocs();
      setDocs(items);
    } catch (e) {
      console.warn('Failed to load academic documents:', e);
    }
  }, []);

  useEffect(() => {
    loadDocs();
    // Opportunistic header revalidation on screen entry
    handleRevalidate(false);
  }, [loadDocs]);

  const handleRevalidate = async (showToast = true) => {
    if (isRevalidating) return;
    setIsRevalidating(true);
    try {
      const { docs: refreshed, updatedCount } = await AcademicDocsService.revalidateAllSchedules();
      setDocs(refreshed);
      if (showToast) {
        if (updatedCount > 0) {
          Alert.alert(
            'Schedules Updated 📅',
            `${updatedCount} schedule document(s) have been updated on the DOAA server and refreshed locally.`
          );
        } else {
          Alert.alert(
            'Up to Date ✅',
            'All academic calendars and examination schedules are up to date with the DOAA portal.'
          );
        }
      }
    } catch (e) {
      console.warn('Revalidation check error:', e);
      if (showToast) {
        Alert.alert('Network Notice', 'Could not reach DOAA server to check for updates. Showing cached copies.');
      }
    } finally {
      setIsRevalidating(false);
      setRefreshing(false);
    }
  };

  const handlePullRefresh = () => {
    setRefreshing(true);
    handleRevalidate(true);
  };

  const handleOpenDoc = async (item: AcademicDoc) => {
    if (activeOpeningId) return; // Prevent concurrent taps
    setActiveOpeningId(item.id);
    setDownloadProgress(0);

    try {
      await AcademicDocsService.openDoc(item.id, (fraction) => {
        setDownloadProgress(fraction);
      });
      // Refresh local cache indicators
      await loadDocs();
    } catch (err: any) {
      console.warn('Error opening document:', err);
      Alert.alert(
        'Could Not Open Document',
        err?.message || 'Failed to download or open the PDF. Please check your internet connection and try again.'
      );
    } finally {
      setActiveOpeningId(null);
      setDownloadProgress(0);
    }
  };

  const filteredDocs = docs.filter((doc) => {
    if (selectedCategory === 'ALL') return true;
    return doc.category === selectedCategory;
  });

  const getCategoryColor = (category: DocCategory) => {
    switch (category) {
      case 'CALENDAR':
        return Theme.colors.primary;
      case 'TIMETABLE':
        return Theme.colors.mint;
      case 'EXAM':
        return Theme.colors.pink;
      case 'HOLIDAYS':
        return Theme.colors.lavender;
      default:
        return Theme.colors.surfaceLight;
    }
  };

  const getCategoryIcon = (category: DocCategory): keyof typeof Ionicons.glyphMap => {
    switch (category) {
      case 'CALENDAR':
        return 'calendar';
      case 'TIMETABLE':
        return 'time';
      case 'EXAM':
        return 'newspaper';
      case 'HOLIDAYS':
        return 'sunny';
      default:
        return 'document-text';
    }
  };

  const renderDocCard = ({ item }: { item: AcademicDoc }) => {
    const isOpeningThis = activeOpeningId === item.id;
    const catColor = getCategoryColor(item.category);
    const catIcon = getCategoryIcon(item.category);

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.75}
        onPress={() => handleOpenDoc(item)}
        disabled={isOpeningThis}
      >
        <View style={styles.cardContent}>
          {/* Left Icon Pill */}
          <View style={[styles.iconContainer, { backgroundColor: `${catColor}25` }]}>
            <Ionicons name={catIcon} size={22} color={catColor} />
          </View>

          {/* Minimal Title & Meta */}
          <View style={styles.textContainer}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.cardMetaText}>
              {item.isCached
                ? `PDF • ${item.fileSizeFormatted || 'Cached'}`
                : 'PDF Document'}
            </Text>
          </View>

          {/* Right Status / Progress Indicator */}
          <View style={styles.actionContainer}>
            {isOpeningThis ? (
              <View style={styles.progressWrap}>
                <ActivityIndicator size="small" color={Theme.colors.primary} />
                {downloadProgress > 0 && downloadProgress < 1 && (
                  <Text style={styles.progressText}>{Math.round(downloadProgress * 100)}%</Text>
                )}
              </View>
            ) : item.isCached ? (
              <View style={styles.cachedBadge}>
                <Ionicons name="checkmark-circle" size={18} color={Theme.colors.mint} />
              </View>
            ) : (
              <View style={styles.openArrow}>
                <Ionicons name="chevron-forward" size={18} color={Theme.colors.textSecondary} />
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={Theme.colors.textPrimary} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Academic Schedules</Text>

        <TouchableOpacity
          style={styles.refreshHeaderBtn}
          onPress={() => handleRevalidate(true)}
          disabled={isRevalidating}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {isRevalidating ? (
            <ActivityIndicator size="small" color={Theme.colors.primary} />
          ) : (
            <Ionicons name="refresh" size={22} color={Theme.colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* Category Filter Chips */}
      <View style={styles.tabsContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CATEGORY_TABS}
          keyExtractor={(t) => t.key}
          contentContainerStyle={styles.tabsScrollContent}
          renderItem={({ item }) => {
            const isSelected = selectedCategory === item.key;
            return (
              <TouchableOpacity
                style={[
                  styles.tabChip,
                  isSelected && styles.tabChipActive,
                ]}
                onPress={() => setSelectedCategory(item.key)}
              >
                <Ionicons
                  name={item.icon}
                  size={15}
                  color={isSelected ? Theme.colors.textDark : Theme.colors.textSecondary}
                  style={styles.tabIcon}
                />
                <Text
                  style={[
                    styles.tabChipText,
                    isSelected && styles.tabChipTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Documents List */}
      <FlatList
        data={filteredDocs}
        keyExtractor={(item) => item.id}
        renderItem={renderDocCard}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Theme.layout.baseScrollBottomPadding + insets.bottom },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handlePullRefresh}
            tintColor={Theme.colors.primary}
            colors={[Theme.colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="folder-open-outline" size={48} color={Theme.colors.textSecondary} />
            <Text style={styles.emptyText}>No documents found for this category.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
    letterSpacing: 0.2,
  },
  refreshHeaderBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabsContainer: {
    marginVertical: 10,
  },
  tabsScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Theme.radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  tabChipActive: {
    backgroundColor: Theme.colors.lavender,
    borderColor: Theme.colors.lavender,
  },
  tabIcon: {
    marginRight: 6,
  },
  tabChipText: {
    color: Theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  tabChipTextActive: {
    color: Theme.colors.textDark,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 12,
  },
  card: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.widget,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  textContainer: {
    flex: 1,
    marginRight: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
    lineHeight: 20,
    marginBottom: 4,
  },
  cardMetaText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    fontWeight: '500',
  },
  actionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: {
    fontSize: 10,
    color: Theme.colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  cachedBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(208, 240, 228, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  openArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
  },
});
