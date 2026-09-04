import React, { useState } from 'react';
import { StyleSheet, Text, View, Image, ScrollView, TouchableOpacity, Modal, FlatList, Dimensions } from 'react-native';
import Svg, { Line, Circle, Polyline, Text as SvgText, Rect, Path, Defs, LinearGradient, Stop, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { ProfileData } from '../services/CacheService';

interface DashboardScreenProps {
  profileData: ProfileData | null;
}

export default function DashboardScreen({ profileData }: DashboardScreenProps) {
  const insets = useSafeAreaInsets();
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'passed' | 'failed'>('passed');

  if (!profileData) {
    return (
      <View style={styles.loadingContainer}>
        <Image 
          source={require('../../assets/icon.png')}
          style={styles.loadingLogo}
        />
        <Text style={styles.loadingText}>No profile cache found. Swipe down on the attendance screen to sync.</Text>
      </View>
    );
  }

  const { name, roll, dept, passedCourses, failedCourses, performance, photoBase64, photoUrl } = profileData;

  const showModal = (type: 'passed' | 'failed') => {
    setModalType(type);
    setModalVisible(true);
  };

  const avatarUri = photoBase64 || photoUrl;

  // --- SVG Custom Chart Configuration ---
  const screenWidth = Dimensions.get('window').width - 40; // width padding
  const chartHeight = 220;
  const paddingLeft = 35;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = screenWidth - paddingLeft - paddingRight;
  const chartInnerHeight = chartHeight - paddingTop - paddingBottom;

  // Y bounds are strictly 1.0 to 10.0
  const minY = 1.0;
  const maxY = 10.0;

  const getX = (index: number, total: number) => {
    if (total <= 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (index / (total - 1)) * chartWidth;
  };

  const getY = (value: number) => {
    const clampedValue = Math.min(Math.max(value, minY), maxY);
    const ratio = (clampedValue - minY) / (maxY - minY);
    // SVG coordinates start from top-left, so subtract from height
    return paddingTop + chartInnerHeight - (ratio * chartInnerHeight);
  };

  // Grid lines values (CPI / GPA levels)
  const gridLines = [2.0, 4.0, 6.0, 8.0, 10.0];

  // Map performance records to coordinates
  const pointsSPI = performance.map((p, i) => ({ x: getX(i, performance.length), y: getY(p.spi) }));
  const pointsCPI = performance.map((p, i) => ({ x: getX(i, performance.length), y: getY(p.cpi) }));

  const spiPolylineString = pointsSPI.map(p => `${p.x},${p.y}`).join(' ');
  const cpiPolylineString = pointsCPI.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <ScrollView 
      style={styles.container} 
      contentContainerStyle={[
        styles.scrollContent, 
        { paddingBottom: Theme.layout.baseScrollBottomPadding + insets.bottom }
      ]}
    >
      
      {/* Profile Header Card */}
      <View style={styles.profileCard}>
        <View style={styles.avatarContainer}>
          {avatarUri ? (
            <Image 
              source={{ uri: avatarUri }}
              style={styles.avatar}
              defaultSource={require('../../assets/icon.png')}
            />
          ) : (
            <Ionicons name="person" size={44} color={Theme.colors.primary} />
          )}
        </View>
        <View style={styles.profileDetails}>
          <Text style={styles.profileName} numberOfLines={1}>{name}</Text>
          <Text style={styles.profileMeta}>Roll Number: {roll}</Text>
          <Text style={styles.profileMeta}>{dept}</Text>
          <View style={styles.badgeContainer}>
            <View style={[styles.cpiBadge, { backgroundColor: Theme.colors.primary }]}>
              <Text style={styles.cpiBadgeText}>
                CPI: {performance.length > 0 ? performance[performance.length - 1].cpi.toFixed(2) : 'N/A'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Academic Progress Badges */}
      <Text style={styles.sectionTitle}>Academic Progress</Text>
      <View style={styles.badgesRow}>
        
        {/* Passed Courses Badge */}
        <TouchableOpacity 
          style={[styles.progressBadge, { backgroundColor: Theme.colors.mint }]} 
          onPress={() => showModal('passed')}
        >
          <View style={styles.badgeIconContainer}>
            <Ionicons name="checkmark-circle" size={24} color={Theme.colors.textDark} />
          </View>
          <Text style={styles.badgeLabel}>Passed Courses</Text>
          <Text style={styles.badgeCount}>{passedCourses.length}</Text>
        </TouchableOpacity>

        {/* Failed Courses Badge */}
        <TouchableOpacity 
          style={[styles.progressBadge, { backgroundColor: Theme.colors.pink }]} 
          onPress={() => showModal('failed')}
        >
          <View style={styles.badgeIconContainer}>
            <Ionicons name="close-circle" size={24} color={Theme.colors.textDark} />
          </View>
          <Text style={styles.badgeLabel}>Failed Courses</Text>
          <Text style={styles.badgeCount}>{failedCourses.length}</Text>
        </TouchableOpacity>
      </View>

      {/* CPI/SPI Performance Chart */}
      <Text style={styles.sectionTitle}>Academic Performance Trend</Text>
      <View style={styles.chartCard}>
        <View style={styles.chartLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: Theme.colors.primary }]} />
            <Text style={styles.legendText}>CPI (Cumulative)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: Theme.colors.pink }]} />
            <Text style={styles.legendText}>SPI (Semester)</Text>
          </View>
        </View>

        <View style={styles.svgWrapper}>
          <Svg width={screenWidth} height={chartHeight}>
            <Defs>
              <LinearGradient id="cpiGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={Theme.colors.primary} stopOpacity={0.2} />
                <Stop offset="100%" stopColor={Theme.colors.primary} stopOpacity={0.0} />
              </LinearGradient>
            </Defs>

            {/* Grid Lines and Y-Axis labels */}
            {gridLines.map(val => (
              <G key={val}>
                <Line 
                  x1={paddingLeft} 
                  y1={getY(val)} 
                  x2={screenWidth - paddingRight} 
                  y2={getY(val)} 
                  stroke={Theme.colors.border} 
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <SvgText 
                  x={paddingLeft - 8} 
                  y={getY(val) + 4} 
                  fill={Theme.colors.textSecondary} 
                  fontSize="10" 
                  textAnchor="end"
                >
                  {val.toFixed(1)}
                </SvgText>
              </G>
            ))}

            {/* Area under CPI line */}
            {performance.length > 1 && (
              <Path 
                d={`M ${pointsCPI[0].x} ${getY(minY)} L ${pointsCPI.map(p => `${p.x} ${p.y}`).join(' L ')} L ${pointsCPI[pointsCPI.length - 1].x} ${getY(minY)} Z`} 
                fill="url(#cpiGrad)"
              />
            )}

            {/* SPI and CPI Polylines */}
            {performance.length > 1 && (
              <>
                <Polyline 
                  points={spiPolylineString} 
                  fill="none" 
                  stroke={Theme.colors.pink} 
                  strokeWidth="2.5" 
                  strokeDasharray="2 2"
                />
                <Polyline 
                  points={cpiPolylineString} 
                  fill="none" 
                  stroke={Theme.colors.primary} 
                  strokeWidth="3.5"
                />
              </>
            )}

            {/* Data point markers */}
            {pointsSPI.map((p, i) => (
              <Circle 
                key={`spi-dot-${i}`} 
                cx={p.x} 
                cy={p.y} 
                r="4" 
                fill={Theme.colors.pink} 
              />
            ))}
            {pointsCPI.map((p, i) => (
              <Circle 
                key={`cpi-dot-${i}`} 
                cx={p.x} 
                cy={p.y} 
                r="5" 
                fill={Theme.colors.primary} 
                stroke={Theme.colors.background}
                strokeWidth="1.5"
              />
            ))}

            {/* X-Axis labels (Semester codes) */}
            {performance.map((p, i) => {
              // Simplify semester codes (e.g. "2024-2025-1" -> "Sem 1")
              const semLabel = p.sem.split('-').slice(-1)[0] === '1' ? 'Odd' : p.sem.split('-').slice(-1)[0] === '2' ? 'Even' : 'Sum';
              const yearLabel = p.sem.split('-')[0].slice(2) + '-' + p.sem.split('-')[1].slice(2);
              return (
                <G key={`x-lbl-${i}`}>
                  <SvgText 
                    x={getX(i, performance.length)} 
                    y={chartHeight - 14} 
                    fill={Theme.colors.textPrimary} 
                    fontSize="10" 
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    {semLabel}
                  </SvgText>
                  <SvgText 
                    x={getX(i, performance.length)} 
                    y={chartHeight - 2} 
                    fill={Theme.colors.textSecondary} 
                    fontSize="8" 
                    textAnchor="middle"
                  >
                    {yearLabel}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
        </View>
      </View>

      {/* Academic Courses Details Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
        statusBarTranslucent={true}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity 
            style={styles.modalDismiss} 
            activeOpacity={1} 
            onPress={() => setModalVisible(false)} 
          />
          <View style={styles.modalContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {modalType === 'passed' ? 'Passed Courses' : 'Failed Courses'}
              </Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={Theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>
            
            <FlatList
              data={modalType === 'passed' ? passedCourses : failedCourses}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <View style={styles.courseItem}>
                  <Ionicons 
                    name={modalType === 'passed' ? 'checkmark-circle' : 'alert-circle'} 
                    size={20} 
                    color={modalType === 'passed' ? Theme.colors.success : Theme.colors.error} 
                  />
                  <Text style={styles.courseText}>{item}</Text>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No courses in this category.</Text>
              }
              contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(24, insets.bottom + 16) }]}
            />
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  scrollContent: {
    padding: Theme.spacing.padding,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  loadingLogo: {
    width: 60,
    height: 60,
    marginBottom: 20,
  },
  loadingText: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  profileCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.card,
    padding: Theme.spacing.padding,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: Theme.spacing.gap * 1.5,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Theme.colors.background,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Theme.colors.primary,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  profileDetails: {
    marginLeft: 16,
    flex: 1,
  },
  profileName: {
    color: Theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: 'bold',
  },
  profileMeta: {
    color: Theme.colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  badgeContainer: {
    flexDirection: 'row',
    marginTop: 8,
  },
  cpiBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Theme.radii.pill,
  },
  cpiBadgeText: {
    color: Theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.gap,
  },
  badgesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.gap * 1.5,
  },
  progressBadge: {
    width: '48%',
    borderRadius: Theme.radii.widget,
    padding: Theme.spacing.padding,
    alignItems: 'center',
  },
  badgeIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(26, 28, 35, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  badgeLabel: {
    color: Theme.colors.textDark,
    fontSize: 12,
    fontWeight: '600',
  },
  badgeCount: {
    color: Theme.colors.textDark,
    fontSize: 26,
    fontWeight: 'bold',
    marginTop: 4,
  },
  chartCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.card,
    paddingVertical: Theme.spacing.padding,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  chartLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: Theme.spacing.gap,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  legendText: {
    color: Theme.colors.textSecondary,
    fontSize: 11,
  },
  svgWrapper: {
    alignItems: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalDismiss: {
    flex: 1,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Theme.colors.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalContent: {
    width: '100%',
    backgroundColor: Theme.colors.surface,
    borderTopLeftRadius: Theme.radii.card,
    borderTopRightRadius: Theme.radii.card,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '60%',
    minHeight: '40%',
    paddingHorizontal: Theme.spacing.padding,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.gap,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  closeBtn: {
    padding: 4,
  },
  listContent: {
    paddingBottom: 20,
  },
  courseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  courseText: {
    color: Theme.colors.textPrimary,
    fontSize: 14,
    marginLeft: 12,
    fontWeight: '500',
  },
  emptyText: {
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
  },
});
