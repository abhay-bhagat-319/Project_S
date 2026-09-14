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

  const renderDocCard = ({ item }: { item: AcademicDoc }) => {
    const isOpeningThis = activeOpeningId === item.id;
    const catColor = getCategoryColor(item.category);

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.75}
        onPress={() => handleOpenDoc(item)}
        disabled={isOpeningThis}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.categoryPill, { backgroundColor: catColor }]}>
            <Text style={styles.categoryPillText}>{item.category}</Text>
          </View>

          {item.isCached ? (
            <View style={styles.cachedBadge}>
              <Ionicons name="checkmark-circle" size={14} color={Theme.colors.success} />
              <Text style={styles.cachedBadgeText}>
                {item.fileSizeFormatted ? `Cached • ${item.fileSizeFormatted}` : 'Cached'}
              </Text>
            </View>
          ) : (
            <View style={styles.uncachedBadge}>
              <Ionicons name="cloud-download-outline" size={14} color={Theme.colors.textSecondary} />
              <Text style={styles.uncachedBadgeText}>Online</Text>
            </View>
          )}
        </View>

        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.cardDesc}>{item.description}</Text>

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Ionicons name="document-text-outline" size={14} color={Theme.colors.textSecondary} />
            <Text style={styles.footerFileName} numberOfLines={1}>
              {item.fileName}
            </Text>
          </View>

          <View style={styles.actionBtnContainer}>
            {isOpeningThis ? (
              <View style={styles.openingIndicatorRow}>
                <ActivityIndicator size="small" color={Theme.colors.primary} />
                <Text style={styles.openingText}>
                  {downloadProgress > 0 ? `${Math.round(downloadProgress * 100)}%` : 'Opening...'}
                </Text>
              </View>
            ) : (
              <View style={styles.openBtnPill}>
                <Text style={styles.openBtnText}>
                  {item.isCached ? 'Open PDF' : 'Download & Open'}
                </Text>
                <Ionicons
                  name={item.isCached ? 'open-outline' : 'download-outline'}
                  size={14}
                  color={Theme.colors.textDark}
                />
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
          <Text style={styles.backButtonText}>Profile</Text>
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
            <Ionicons name="refresh-outline" size={22} color={Theme.colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* Subheader Notice */}
      <View style={styles.syncBanner}>
        <Ionicons name="shield-checkmark-outline" size={16} color={Theme.colors.primary} />
        <Text style={styles.syncBannerText}>
          Real-time synchronized with DOAA Academic Portal (iiserb.ac.in)
        </Text>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  backButtonText: {
    color: Theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
  },
  refreshHeaderBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 32,
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: Theme.radii.widget,
    gap: 8,
  },
  syncBannerText: {
    color: Theme.colors.textSecondary,
    fontSize: 12,
    flex: 1,
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
    borderColor: Theme.colors.border,
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
    padding: 16,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Theme.radii.pill,
  },
  categoryPillText: {
    color: Theme.colors.textDark,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cachedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(76, 217, 100, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Theme.radii.pill,
  },
  cachedBadgeText: {
    color: Theme.colors.success,
    fontSize: 11,
    fontWeight: '600',
  },
  uncachedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Theme.radii.pill,
  },
  uncachedBadgeText: {
    color: Theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13,
    color: Theme.colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 12,
  },
  footerFileName: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    flex: 1,
  },
  actionBtnContainer: {
    minHeight: 32,
    justifyContent: 'center',
  },
  openingIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  openingText: {
    color: Theme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  openBtnPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surfaceLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Theme.radii.pill,
    gap: 6,
  },
  openBtnText: {
    color: Theme.colors.textDark,
    fontSize: 12,
    fontWeight: '700',
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
