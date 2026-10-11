import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Alert, StatusBar, Platform, BackHandler, ToastAndroid } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';

import PagerView from 'react-native-pager-view';

import { Theme } from './src/Theme';
import { SecureStorageService } from './src/services/SecureStorageService';
import { CacheService, ProfileData, AttendanceData, CourseDetail } from './src/services/CacheService';
import { ScraperService } from './src/services/ScraperService';
import { ReportsService } from './src/services/ReportsService';
import { SessionLifecycleManager } from './src/services/SessionLifecycleManager';
import { HttpPortalClient, PortalHttpError, PortalErrorCode } from './src/services/HttpPortalClient';
import { SyncDiagnostics } from './src/services/SyncDiagnostics';

import LockScreen from './src/screens/LockScreen';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import CoursesScreen, { Course } from './src/screens/CoursesScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import PortalWebviewScreen, { PortalWebviewHandle } from './src/screens/PortalWebviewScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AcademicSchedulesScreen from './src/screens/AcademicSchedulesScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import UpdateModal from './src/screens/UpdateModal';
import BackgroundDownloadPill from './src/components/BackgroundDownloadPill';
import SyncStatusBanner from './src/components/SyncStatusBanner';
import { UpdateService, UpdateInfo } from './src/services/UpdateService';
import { NotificationService } from './src/services/NotificationService';

type AppState = 'INITIALIZING' | 'NEEDS_LOGIN' | 'LOCKED' | 'LOGGED_IN';
type TabName = 'Profile' | 'Attendance' | 'Courses' | 'Portal' | 'Settings';

const TABS: TabName[] = ['Profile', 'Attendance', 'Courses', 'Portal', 'Settings'];
const getTabIndex = (tab: TabName): number => Math.max(0, TABS.indexOf(tab));
const getTabFromIndex = (index: number): TabName => TABS[index] ?? 'Profile';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

export type SyncScope = 'ALL' | 'ATTENDANCE' | 'COURSES' | 'MARKS' | 'PROFILE' | 'REPORTS';

function AppContent() {
  const insets = useSafeAreaInsets();
  const [appState, setAppState] = useState<AppState>('INITIALIZING');
  const [activeTab, setActiveTab] = useState<TabName>('Profile');
  const [subScreen, setSubScreen] = useState<'academic_schedules' | 'reports' | null>(null);
  const pagerRef = useRef<PagerView>(null);
  
  // Scraped Data
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseDetails, setCourseDetails] = useState<Record<string, CourseDetail>>({});
  
  // Sync States
  const [syncActive, setSyncActive] = useState(false);
  const [syncScope, setSyncScope] = useState<SyncScope>('ALL');
  const syncScopeRef = useRef<SyncScope>('ALL');
  const priorityCourseCodeRef = useRef<string>('');
  const marksResolveMapRef = useRef<Record<string, (marks: any) => void>>({});
  const syncResolverRef = useRef<(() => void) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Last sync failure, surfaced through the SyncStatusBanner. Kept separately
  // from the data state so a failed refresh never looks like "you have no data".
  const [syncError, setSyncError] = useState<{
    scope: SyncScope;
    code: PortalErrorCode;
    message: string;
  } | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  
  // Portal Navigation Target
  const [portalTargetUrl, setPortalTargetUrl] = useState<string | null>(null);

  // In-App Update State
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  const [bgDownload, setBgDownload] = useState<{
    isDownloading: boolean;
    progress: number;
    isComplete: boolean;
    versionTag: string;
  }>({
    isDownloading: false,
    progress: 0,
    isComplete: false,
    versionTag: '',
  });

  // Active Credentials
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);
  const portalWebviewRef = useRef<PortalWebviewHandle>(null);
  const lastBackPressRef = useRef<number>(0);

  // Register Root PDF Downloader bridge with Portal WebView
  useEffect(() => {
    const unregisterPdf = ReportsService.registerPdfDownloader((fileUrl, reportId) => {
      const pendingPromise = ReportsService.createPendingPdfDownload(reportId);
      const script = ScraperService.getPdfDownloadScript(fileUrl, reportId);
      if (portalWebviewRef.current?.injectJavaScript) {
        portalWebviewRef.current.injectJavaScript(script);
      }
      return pendingPromise;
    });

    return () => {
      unregisterPdf();
    };
  }, []);

  // Android Hardware Back Button Navigation Handler
  useEffect(() => {
    const handleBackPress = () => {
      // 1. If not logged in, allow default system exit/back
      if (appState !== 'LOGGED_IN') {
        return false;
      }

      // 2. If UpdateModal is open, dismiss it
      if (updateModalVisible) {
        setUpdateModalVisible(false);
        return true;
      }

      // 3. If SubScreen is open (Academic Schedules or Reports), return to Dashboard
      if (subScreen !== null) {
        setSubScreen(null);
        return true;
      }

      // 4. If on Portal tab, check if WebView has back history
      if (activeTab === 'Portal') {
        const handledByWebview = portalWebviewRef.current?.handleBackPress();
        if (handledByWebview) {
          return true;
        }
        // If webview cannot go back, switch to Profile tab
        handleTabPress('Profile');
        return true;
      }

      // 5. If on any other non-Profile tab, switch to Profile
      if (activeTab !== 'Profile') {
        handleTabPress('Profile');
        return true;
      }

      // 6. If on Profile tab, double-tap back within 2000ms to exit
      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }

      lastBackPressRef.current = now;
      if (Platform.OS === 'android') {
        ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
      }
      return true;
    };

    const backSubscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => backSubscription.remove();
  }, [appState, updateModalVisible, subScreen, activeTab]);

  useEffect(() => {
    bootstrapApp();
    NotificationService.init().catch(() => {});

    // Listen for notification tap responses
    const unsubscribeNotification = NotificationService.registerResponseListener((action, version) => {
      if (action === 'INSTALL_UPDATE' && version) {
        UpdateService.installCachedApk(version).catch((err) => {
          Alert.alert('Install Failed', err?.message || 'Could not launch package installer.');
        });
      } else if (action === 'OPEN_UPDATE_MODAL') {
        setUpdateModalVisible(true);
      }
    });

    // Handle cold launch from tapped notification
    NotificationService.checkColdLaunchResponse((action, version) => {
      if (action === 'INSTALL_UPDATE' && version) {
        UpdateService.installCachedApk(version).catch(() => {});
      }
    }).catch(() => {});

    // Subscribe to unified background download progress
    const unsubscribeProgress = UpdateService.addProgressListener((fraction) => {
      setBgDownload((prev) => ({
        isDownloading: fraction > 0 && fraction < 1,
        progress: fraction,
        isComplete: fraction >= 1,
        versionTag: prev.versionTag,
      }));
    });

    checkAppUpdates();

    return () => {
      unsubscribeNotification();
      unsubscribeProgress();
    };
  }, []);

  const checkAppUpdates = async () => {
    try {
      const info = await UpdateService.checkForUpdate();
      if (info.hasUpdate) {
        setUpdateInfo(info);
        setBgDownload((prev) => ({ ...prev, versionTag: info.latestVersion }));
        // Prompt user on every launch if an update is available
        setUpdateModalVisible(true);

        // If not already cached on disk, silently prefetch in the background
        if (!info.isCached && info.apkDownloadUrl && !UpdateService.isDownloading(info.latestVersion)) {
          UpdateService.prefetchUpdateSilently(info).then((downloaded) => {
            if (downloaded) {
              setUpdateInfo((prev) => (prev ? { ...prev, isCached: true } : prev));
            }
          });
        }
      } else {
        setUpdateInfo(null);
        NotificationService.clearUpdateNotification().catch(() => {});
      }
    } catch (err) {
      console.log('Startup update check error:', err);
    }
  };

  const handleInstallCachedFromPill = async () => {
    if (bgDownload.versionTag) {
      try {
        await UpdateService.installCachedApk(bgDownload.versionTag);
      } catch (e: any) {
        Alert.alert('Install Failed', e?.message || 'Could not open package installer.');
      }
    }
  };

  const bootstrapApp = async () => {
    try {
      const creds = await SecureStorageService.getCredentials();
      setCredentials(creds);

      if (creds) {
        const isBioEnabled = await SecureStorageService.isBiometricsEnabled();
        if (isBioEnabled) {
          setAppState('LOCKED');
        } else {
          await loadCacheAndLogin();
        }
      } else {
        setAppState('NEEDS_LOGIN');
      }
    } catch (e) {
      console.log('Bootstrap failed:', e);
      setAppState('NEEDS_LOGIN');
    }
  };

  const loadCacheAndLogin = async () => {
    // Age of the newest successfully synced scope (for the status banner)
    CacheService.getLastSuccessAt()
      .then((at) => setLastSyncAt(at))
      .catch(() => {});

    // Load local cache to immediately show dashboards offline
    const cachedProfile = await CacheService.getCachedProfileData();
    const cachedAttendance = await CacheService.getCachedAttendanceData();
    const cachedCourses = await CacheService.getCachedCoursesData();
    const cachedDetails = await CacheService.getCachedCourseDetails();
    
    if (cachedProfile) {
      setProfileData(cachedProfile);
    }
    if (cachedCourses && cachedCourses.length > 0) {
      setCourses(cachedCourses);
    } else if (cachedAttendance) {
      // Map attendance item list back to registered course structures
      const mappedCourses = cachedAttendance.items.map(item => ({
        courseCode: item.courseCode,
        courseTitle: item.courseTitle,
        instructor: item.instructor,
        srsStatus: {
          midSemAvailable: !!item.srsStatus?.midSemAvailable,
          midSemUrl: item.srsStatus?.midSemUrl,
          endSemAvailable: !!item.srsStatus?.endSemAvailable,
          endSemUrl: item.srsStatus?.endSemUrl,
        }
      }));
      setCourses(mappedCourses);
    }
    if (cachedAttendance) {
      setAttendanceData(cachedAttendance);
    }
    if (cachedDetails) {
      setCourseDetails(cachedDetails);
    }

    setAppState('LOGGED_IN');

    // Trigger sync check (with 24h cooldown check)
    checkAndTriggerSync();
  };

  const checkAndTriggerSync = async () => {
    // Check sync cooldown
    const needsSync = await CacheService.isSyncCooledDown();
    if (needsSync) {
      runSync('ALL');
    }
  };

  const finishSync = () => {
    setSyncActive(false);
    setRefreshing(false);
    if (syncResolverRef.current) {
      syncResolverRef.current();
      syncResolverRef.current = null;
    }
  };

  /**
   * Single entry point for every portal sync.
   *
   * Previously startSync() and handleManualRefresh() each re-implemented the
   * same five-way scope switch with subtle drift (manual refresh bypassed
   * syncActive, so the header spinner never appeared; the REPORTS scope updated
   * no state at all). Both are now this one function.
   */
  const runSync = async (
    scope: SyncScope = 'ALL',
    options: { userInitiated?: boolean; priorityCourseCode?: string } = {}
  ): Promise<void> => {
    const creds = await SecureStorageService.getCredentials();
    if (!creds) {
      setAppState('NEEDS_LOGIN');
      finishSync();
      return;
    }
    setCredentials(creds);

    const userInitiated = options.userInitiated === true;

    console.log(`Starting portal sync [scope: ${scope}${options.priorityCourseCode ? `, priority: ${options.priorityCourseCode}` : ''}]...`);
    syncScopeRef.current = scope;
    priorityCourseCodeRef.current = options.priorityCourseCode || '';
    setSyncScope(scope);
    setSyncActive(true);
    if (userInitiated) {
      setRefreshing(true);
    } else {
      setRefreshing(false);
    }

    try {
      if (scope === 'PROFILE') {
        const freshProfile = await HttpPortalClient.syncProfile();
        setProfileData(freshProfile);
      } else if (scope === 'COURSES') {
        const freshCourses = await HttpPortalClient.syncCourses();
        setCourses(freshCourses.courses);
        if (freshCourses.courseDetails) {
          setCourseDetails((prev) => ({ ...prev, ...freshCourses.courseDetails }));
        }
      } else if (scope === 'ATTENDANCE') {
        // Reuse the cached course list when it is fresh, so a pull-to-refresh
        // does not re-download the whole My Courses page. Cards update as each
        // course request lands.
        const cachedCourses = await CacheService.getCachedCoursesData();
        const coursesAreFresh = !(await CacheService.isScopeStale('COURSES', 12 * 60 * 60 * 1000));
        // Only skip the /studentMyCourses fetch when every cached course carries
        // the portal's own attendance argument; otherwise the per-course POSTs
        // could be built with the wrong identifier.
        const reusableCourses =
          coursesAreFresh &&
          cachedCourses &&
          cachedCourses.length > 0 &&
          cachedCourses.every((c) => !!c.attendanceArg)
            ? cachedCourses
            : undefined;
        const freshAttendance = await HttpPortalClient.syncAttendance({
          courses: reusableCourses,
          onCourse: (item) => {
            setAttendanceData((prev) => {
              if (!prev) {
                // First sync with no cache yet: still show cards as they land.
                return { items: [item], timestamp: new Date().toISOString() };
              }
              const existingIndex = prev.items.findIndex((i) => i.courseCode === item.courseCode);
              const items =
                existingIndex >= 0
                  ? prev.items.map((i, idx) => (idx === existingIndex ? item : i))
                  : [...prev.items, item];
              return { ...prev, items };
            });
          },
        });
        setAttendanceData(freshAttendance);
      } else if (scope === 'REPORTS') {
        await ReportsService.syncReports();
      } else if (scope === 'MARKS') {
        const fresh = await HttpPortalClient.syncCourses();
        setCourses(fresh.courses);
        if (fresh.courseDetails) {
          setCourseDetails((prev) => ({ ...prev, ...fresh.courseDetails }));
          if (options.priorityCourseCode && fresh.courseDetails[options.priorityCourseCode] && marksResolveMapRef.current[options.priorityCourseCode]) {
            marksResolveMapRef.current[options.priorityCourseCode](fresh.courseDetails[options.priorityCourseCode]);
            delete marksResolveMapRef.current[options.priorityCourseCode];
          }
        }
      } else if (scope === 'ALL') {
        const result = await HttpPortalClient.syncAll();

        // Only overwrite state for scopes that actually succeeded; failed or
        // degraded scopes keep whatever the cache/UI already shows.
        if (result.profile) setProfileData(result.profile);
        if (result.courses) setCourses(result.courses);
        if (result.courseDetails) {
          setCourseDetails((prev) => ({ ...prev, ...result.courseDetails }));
        }
        if (result.attendance) setAttendanceData(result.attendance);

        if (result.errors.length > 0) {
          const primary = result.errors[0];
          setSyncError({ scope: primary.scope, code: primary.code, message: primary.message });
        } else {
          setSyncError(null);
        }
      }

      if (scope !== 'ALL') {
        setSyncError(null);
      }
    } catch (err: any) {
      const code: PortalErrorCode = err instanceof PortalHttpError ? err.code : 'UNKNOWN';
      const message = err?.message || 'Sync failed.';
      console.warn(`[runSync] scope [${scope}] failed (${code}): ${message}`);
      setSyncError({ scope, code, message });
    } finally {
      CacheService.getLastSuccessAt()
        .then((at) => setLastSyncAt(at))
        .catch(() => {});
      finishSync();
    }
  };

  const handleManualRefresh = async (scope: SyncScope = 'ATTENDANCE') => {
    await runSync(scope, { userInitiated: true });
  };

  const handleRetryFromBanner = async () => {
    const scope = syncError?.scope || 'ALL';
    await runSync(scope, { userInitiated: true });
  };

  const handleRefreshMarks = async (courseCode: string): Promise<any> => {
    try {
      const fresh = await HttpPortalClient.syncCourses();
      setCourses(fresh.courses);
      if (fresh.courseDetails) {
        setCourseDetails((prev) => ({ ...prev, ...fresh.courseDetails }));
        return fresh.courseDetails[courseCode] || null;
      }
    } catch (e) {
      console.warn(`Failed to refresh marks for ${courseCode}:`, e);
    }
    return null;
  };

  // Top level state callbacks
  const handleLoginSuccess = async () => {
    const creds = await SecureStorageService.getCredentials();
    setCredentials(creds);
    
    // Automatically prompt to enable biometrics
    Alert.alert(
      'Biometric Login',
      'Would you like to enable fingerprint/face authentication for faster secure unlock?',
      [
        { text: 'No', style: 'cancel', onPress: () => completeLogin() },
        { 
          text: 'Yes', 
          onPress: async () => {
            await SecureStorageService.setBiometricsEnabled(true);
            completeLogin();
          }
        }
      ]
    );
  };

  const completeLogin = async () => {
    setAppState('LOGGED_IN');
    runSync('ALL');
  };

  const handleUnlockSuccess = async () => {
    await loadCacheAndLogin();
  };

  const handleLogoutSuccess = () => {
    setProfileData(null);
    setAttendanceData(null);
    setCourses([]);
    setCourseDetails({});
    setCredentials(null);
    setSyncError(null);
    setLastSyncAt(null);
    setSubScreen(null);
    setActiveTab('Profile');
    pagerRef.current?.setPageWithoutAnimation(0);
    setAppState('NEEDS_LOGIN');
  };

  const handleOpenSrs = (courseCode: string) => {
    const srsUrl = `https://shiksha.iiserb.ac.in/secure/studentSRS/${courseCode}`;
    setPortalTargetUrl(srsUrl);
    handleTabPress('Portal');
  };



  const handleTabPress = (tab: TabName) => {
    setSubScreen(null);
    setActiveTab(tab);
    const targetIndex = getTabIndex(tab);
    pagerRef.current?.setPageWithoutAnimation(targetIndex);
  };

  const isPagerScrollEnabled = activeTab !== 'Portal' && subScreen === null;

  const handlePageSelected = (e: any) => {
    const pageIndex = e.nativeEvent.position;
    const nextTab = getTabFromIndex(pageIndex);
    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  };

  // Render entry layout based on State
  return (
    <View style={{ flex: 1, backgroundColor: Theme.colors.background }}>
      {appState === 'INITIALIZING' ? (
        <View style={styles.initializingContainer}>
          <ActivityIndicator size="large" color={Theme.colors.primary} />
          <Text style={styles.initializingText}>Loading Shiksha Wrapper...</Text>
        </View>
      ) : appState === 'LOCKED' ? (
        <LockScreen onUnlock={handleUnlockSuccess} />
      ) : appState === 'NEEDS_LOGIN' ? (
        <LoginScreen onSuccess={handleLoginSuccess} />
      ) : (
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
          
          {/* Top Header */}
          {!subScreen && (
            <View style={styles.header}>
              <Text style={styles.headerTitle}>
                {activeTab === 'Courses' ? 'My Courses' : activeTab === 'Portal' ? 'Shiksha Portal' : activeTab}
              </Text>
              {syncActive && (
                <View style={styles.syncSpinner}>
                  <ActivityIndicator size="small" color={Theme.colors.primary} />
                </View>
              )}
            </View>
          )}

      {/* Sync health banner: explains a failed refresh instead of silently
          showing stale/empty data. Hidden while the Portal tab is focused. */}
      {activeTab !== 'Portal' && (
        <SyncStatusBanner
          error={syncError}
          lastSyncAt={lastSyncAt}
          retrying={syncActive}
          onRetry={handleRetryFromBanner}
          onDismiss={() => setSyncError(null)}
        />
      )}

      {/* Screen Content Area with Native Gesture PagerView */}
      <View style={styles.content}>
        {/*
          Native hardware-accelerated horizontal swipe pager.
          - offscreenPageLimit: 4 keeps all tab views mounted to eliminate pop-in and preserve scroll positions
          - scrollEnabled: dynamically locked on the Portal tab (so WebView captures touches) and during subscreen navigation
          - overScrollMode: enables native Android edge stretch and iOS spring bounce
        */}
        <PagerView
          ref={pagerRef}
          style={styles.pagerView}
          initialPage={getTabIndex(activeTab)}
          onPageSelected={handlePageSelected}
          scrollEnabled={isPagerScrollEnabled}
          offscreenPageLimit={4}
          overScrollMode="always"
        >
          {/* Tab 0: Profile / Dashboard */}
          <View key="profile_page" style={styles.pageContainer}>
            {subScreen === 'academic_schedules' ? (
              <AcademicSchedulesScreen onBack={() => setSubScreen(null)} />
            ) : subScreen === 'reports' ? (
              <ReportsScreen 
                onBack={() => setSubScreen(null)} 
                onRefreshPortal={() => runSync('REPORTS', { userInitiated: true })}
                isSyncing={syncActive && syncScope === 'REPORTS'}
              />
            ) : (
              <DashboardScreen 
                profileData={profileData} 
                onNavigateToTab={(tab) => handleTabPress(tab as TabName)}
                onOpenAcademicSchedules={() => setSubScreen('academic_schedules')}
                onOpenReports={() => setSubScreen('reports')}
                onRefresh={() => handleManualRefresh('PROFILE')}
                refreshing={refreshing && syncScope === 'PROFILE'}
              />
            )}
          </View>

          {/* Tab 1: Attendance */}
          <View key="attendance_page" style={styles.pageContainer}>
            <AttendanceScreen 
              attendanceData={attendanceData} 
              onRefresh={() => handleManualRefresh('ATTENDANCE')} 
              refreshing={refreshing && syncScope === 'ATTENDANCE'}
              isOffline={isOffline}
            />
          </View>

          {/* Tab 2: Courses */}
          <View key="courses_page" style={styles.pageContainer}>
            <CoursesScreen 
              courses={courses} 
              courseDetails={courseDetails}
              onNavigateToTab={(tab) => handleTabPress(tab as TabName)}
              onOpenSrs={handleOpenSrs}
              onRefresh={() => handleManualRefresh('COURSES')}
              refreshing={refreshing && syncScope === 'COURSES'}
              onRefreshMarks={handleRefreshMarks}
            />
          </View>

          {/* Tab 3: Portal */}
          <View key="portal_page" style={styles.pageContainer}>
            <PortalWebviewScreen 
              ref={portalWebviewRef}
              credentials={credentials} 
              targetUrl={portalTargetUrl}
              onClearTargetUrl={() => setPortalTargetUrl(null)}
            />
          </View>

          {/* Tab 4: Settings */}
          <View key="settings_page" style={styles.pageContainer}>
            <SettingsScreen 
              onLogout={handleLogoutSuccess} 
              onCredentialsUpdated={bootstrapApp}
              hasUpdate={!!updateInfo?.hasUpdate}
              updateInfo={updateInfo}
              onUpdateStatusChecked={(info) => {
                if (info.hasUpdate) {
                  setUpdateInfo(info);
                } else {
                  setUpdateInfo(null);
                }
              }}
              onOpenUpdateModal={(info) => {
                setUpdateInfo(info);
                setUpdateModalVisible(true);
              }}
            />
          </View>
        </PagerView>
      </View>

      {/* Bottom Black Gradient Scrim (Underneath Navigation Bar) */}
      <View 
        style={[
          styles.bottomGradientWrapper, 
          { height: insets.bottom + 96 }
        ]} 
        pointerEvents="none"
      >
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <SvgLinearGradient id="bottomNavScrim" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor="#000000" stopOpacity="0" />
              <Stop offset="30%" stopColor="#000000" stopOpacity="0.25" />
              <Stop offset="65%" stopColor="#000000" stopOpacity="0.70" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0.95" />
            </SvgLinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#bottomNavScrim)" />
        </Svg>
      </View>

      {/* Custom Floating Pill 5-Item Bottom Navigation Bar */}
      <View style={[styles.navBarWrapper, { bottom: Math.max(16, insets.bottom + Theme.layout.navBarBaseBottom) }]}>
        <View style={styles.navBar}>
          
          <TouchableOpacity 
            style={[styles.navItem, activeTab === 'Profile' && styles.activeNavItem]}
            onPress={() => handleTabPress('Profile')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={activeTab === 'Profile' ? 'person' : 'person-outline'} 
              size={20} 
              color={activeTab === 'Profile' ? '#FFFFFF' : Theme.colors.textSecondary} 
            />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navItem, activeTab === 'Attendance' && styles.activeNavItem]}
            onPress={() => handleTabPress('Attendance')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={activeTab === 'Attendance' ? 'calendar' : 'calendar-outline'} 
              size={20} 
              color={activeTab === 'Attendance' ? '#FFFFFF' : Theme.colors.textSecondary} 
            />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navItem, activeTab === 'Courses' && styles.activeNavItem]}
            onPress={() => handleTabPress('Courses')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={activeTab === 'Courses' ? 'book' : 'book-outline'} 
              size={20} 
              color={activeTab === 'Courses' ? '#FFFFFF' : Theme.colors.textSecondary} 
            />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navItem, activeTab === 'Portal' && styles.activeNavItem]}
            onPress={() => handleTabPress('Portal')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={activeTab === 'Portal' ? 'globe' : 'globe-outline'} 
              size={20} 
              color={activeTab === 'Portal' ? '#FFFFFF' : Theme.colors.textSecondary} 
            />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navItem, activeTab === 'Settings' && styles.activeNavItem]}
            onPress={() => handleTabPress('Settings')}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Ionicons 
                name={activeTab === 'Settings' ? 'settings' : 'settings-outline'} 
                size={20} 
                color={activeTab === 'Settings' ? '#FFFFFF' : Theme.colors.textSecondary} 
              />
              {updateInfo?.hasUpdate && (
                <View style={styles.badgeDot} />
              )}
            </View>
          </TouchableOpacity>

        </View>
      </View>

      {/* Background Download Floating Pill */}
      <BackgroundDownloadPill
        isDownloading={bgDownload.isDownloading}
        progress={bgDownload.progress}
        isComplete={bgDownload.isComplete}
        versionTag={bgDownload.versionTag}
        onPressInstall={handleInstallCachedFromPill}
        onDismiss={() => setBgDownload((prev) => ({ ...prev, isComplete: false }))}
      />

      {/* In-App Update Bottom Sheet Modal */}
      <UpdateModal
        visible={updateModalVisible}
        updateInfo={updateInfo}
        onClose={() => setUpdateModalVisible(false)}
        onSnooze={() => {}}
      />
        </View>
      )}


    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  initializingContainer: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  initializingText: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
    marginTop: 16,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.padding,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  syncSpinner: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  bottomGradientWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 40,
  },
  navBarWrapper: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    zIndex: 50,
  },
  navBar: {
    flexDirection: 'row',
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.pill,
    height: 60,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  navItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeNavItem: {
    backgroundColor: Theme.colors.primary,
  },
  iconContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#eab308', // Vibrant yellow notification dot
    borderWidth: 1.5,
    borderColor: Theme.colors.surface,
  },
  pagerView: {
    flex: 1,
  },
  pageContainer: {
    flex: 1,
  },
});
