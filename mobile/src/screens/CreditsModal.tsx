import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
  Linking,
  ActivityIndicator,
  Pressable,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { ContributorsService, Contributor, CREATOR_PROFILE } from '../services/ContributorsService';
import { AppConfig } from '../constants/Config';

interface CreditsModalProps {
  visible: boolean;
  onClose: () => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function CreditsModal({ visible, onClose }: CreditsModalProps) {
  const insets = useSafeAreaInsets();
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (visible) {
      loadContributors();
    }
  }, [visible]);

  const loadContributors = async () => {
    setLoading(true);
    const data = await ContributorsService.getContributors();
    setContributors(data);
    setLoading(false);
  };

  const handleOpenUrl = (url: string) => {
    Linking.openURL(url).catch((err) => console.log('Error opening profile URL:', err));
  };

  // Filter out creator from the community list so he remains exclusively pinned at the top
  const communityContributors = contributors.filter(
    (c) => c.login.toLowerCase() !== CREATOR_PROFILE.login.toLowerCase()
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.backdropPressable} onPress={onClose} />

        <View style={[styles.modalContainer, { maxHeight: SCREEN_HEIGHT * 0.88, paddingBottom: Math.max(insets.bottom, 20) }]}>
          {/* Top Drag Handle */}
          <View style={styles.dragHandleWrapper}>
            <View style={styles.dragIndicator} />
          </View>

          {/* Modal Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.heartIconBadge}>
                <Ionicons name="heart" size={18} color="#ec4899" />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.modalTitle}>Project Credits</Text>
                <Text style={styles.modalSubtitle}>Built by students, for students</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={Theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Lead Maintainer & Creator Section */}
            <Text style={styles.sectionHeader}>Project Creator & Maintainer</Text>
            <TouchableOpacity
              style={styles.creatorCard}
              onPress={() => handleOpenUrl(CREATOR_PROFILE.html_url)}
              activeOpacity={0.75}
            >
              <View style={styles.creatorTopRow}>
                <Image
                  source={{ uri: CREATOR_PROFILE.avatar_url }}
                  style={styles.creatorAvatar}
                  defaultSource={require('../../assets/icon.png')}
                />
                <View style={styles.creatorInfo}>
                  <View style={styles.creatorBadge}>
                    <Ionicons name="star" size={11} color="#f59e0b" style={{ marginRight: 3 }} />
                    <Text style={styles.creatorBadgeText}>Lead Maintainer</Text>
                  </View>
                  <Text style={styles.creatorName}>{CREATOR_PROFILE.name}</Text>
                  <Text style={styles.creatorHandle}>@{CREATOR_PROFILE.login}</Text>
                </View>
                <Ionicons name="open-outline" size={18} color={Theme.colors.lavender} />
              </View>
              <Text style={styles.creatorDescription}>{CREATOR_PROFILE.description}</Text>
            </TouchableOpacity>

            {/* Community Contributors Section */}
            <View style={styles.communityHeaderRow}>
              <Text style={styles.sectionHeader}>Open Source Contributors</Text>
              {communityContributors.length > 0 && (
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{communityContributors.length}</Text>
                </View>
              )}
            </View>

            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={Theme.colors.primary} />
                <Text style={styles.loadingText}>Fetching contributors from GitHub...</Text>
              </View>
            ) : communityContributors.length > 0 ? (
              <View style={styles.contributorsListCard}>
                {communityContributors.map((contributor, index) => (
                  <TouchableOpacity
                    key={contributor.id}
                    style={[
                      styles.contributorRow,
                      index > 0 && styles.contributorRowBorder,
                    ]}
                    onPress={() => handleOpenUrl(contributor.html_url)}
                    activeOpacity={0.7}
                  >
                    <Image
                      source={{ uri: contributor.avatar_url }}
                      style={styles.contributorAvatar}
                    />
                    <View style={styles.contributorInfo}>
                      <Text style={styles.contributorLogin}>@{contributor.login}</Text>
                      <Text style={styles.contributorType}>{contributor.type}</Text>
                    </View>
                    <View style={styles.commitsPill}>
                      <Ionicons name="git-commit-outline" size={13} color={Theme.colors.primary} style={{ marginRight: 3 }} />
                      <Text style={styles.commitsPillText}>
                        {contributor.contributions} {contributor.contributions === 1 ? 'commit' : 'commits'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Ionicons name="git-branch-outline" size={28} color={Theme.colors.textSecondary} />
                <Text style={styles.emptyTitle}>Become a Contributor</Text>
                <Text style={styles.emptyDescription}>
                  Project_S is completely open-source. Help add features, fix bugs, or improve UI on GitHub!
                </Text>
                <TouchableOpacity
                  style={styles.contributeBtn}
                  onPress={() => handleOpenUrl(AppConfig.RELEASES_WEB_URL.replace('/releases/latest', ''))}
                  activeOpacity={0.8}
                >
                  <Ionicons name="logo-github" size={16} color={Theme.colors.textPrimary} style={{ marginRight: 6 }} />
                  <Text style={styles.contributeBtnText}>View GitHub Repo</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Bottom Thank You Note */}
            <View style={styles.thankYouNote}>
              <Text style={styles.thankYouText}>
                Special thanks to all IISERB students who test, submit bug reports, and share feedback!
              </Text>
            </View>
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
    backgroundColor: Theme.colors.surface,
    borderTopLeftRadius: Theme.radii.card * 1.5,
    borderTopRightRadius: Theme.radii.card * 1.5,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingHorizontal: Theme.spacing.padding,
    paddingTop: 12,
  },
  dragHandleWrapper: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    backgroundColor: Theme.colors.border,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
    marginBottom: 16,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  heartIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(236, 72, 153, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: Theme.radii.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  scrollArea: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  creatorCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.card,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    padding: 16,
    marginBottom: 20,
  },
  creatorTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  creatorAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: Theme.colors.primary,
  },
  creatorInfo: {
    flex: 1,
    marginLeft: 14,
  },
  creatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Theme.radii.pill,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  creatorBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fbbf24',
    textTransform: 'uppercase',
  },
  creatorName: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
  },
  creatorHandle: {
    fontSize: 12,
    color: Theme.colors.lavender,
    marginTop: 1,
  },
  creatorDescription: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    lineHeight: 18,
    marginTop: 12,
  },
  communityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  countPill: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Theme.radii.pill,
  },
  countPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.primary,
  },
  contributorsListCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  contributorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  contributorRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
  },
  contributorAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Theme.colors.background,
  },
  contributorInfo: {
    flex: 1,
    marginLeft: 12,
  },
  contributorLogin: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  contributorType: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
    marginTop: 1,
  },
  commitsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Theme.radii.pill,
  },
  commitsPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.primary,
  },
  loadingContainer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    marginTop: 8,
  },
  emptyCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
    marginTop: 8,
  },
  emptyDescription: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 14,
  },
  contributeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Theme.radii.pill,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  contributeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  thankYouNote: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  thankYouText: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
