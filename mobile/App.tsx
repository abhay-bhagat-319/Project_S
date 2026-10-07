import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Alert, StatusBar, Platform, BackHandler, ToastAndroid, AppState as RNAppState } from 'react-native';
import { WebView } from 'react-native-webview';
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
import { NetworkReachabilityService, NetworkState } from './src/services/NetworkReachabilityService';
import { CampusConnectionHelper } from './src/utils/CampusConnectionHelper';

import LockScreen from './src/screens/LockScreen';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import CoursesScreen, { Course } from './src/screens/CoursesScreen';
import { SrsFormData } from './src/screens/CourseSrsModal';
import AttendanceScreen from './src/screens/AttendanceScreen';
import PortalWebviewScreen, { PortalWebviewHandle } from './src/screens/PortalWebviewScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AcademicSchedulesScreen from './src/screens/AcademicSchedulesScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import UpdateModal from './src/screens/UpdateModal';
import BackgroundDownloadPill from './src/components/BackgroundDownloadPill';
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
  const [syncUrl, setSyncUrl] = useState('https://shiksha.iiserb.ac.in/secure/studentMyCourses');
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [networkState, setNetworkState] = useState<NetworkState>('CAMPUS_ACTIVE');
  
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

  // Re-authentication Credentials
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);
  const [authUrl, setAuthUrl] = useState('https://shiksha.iiserb.ac.in/login/');

  const authWebViewRef = useRef<WebView>(null);

  const syncWebViewRef = useRef<WebView>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageScrapeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portalWebviewRef = useRef<PortalWebviewHandle>(null);
  const lastBackPressRef = useRef<number>(0);

  // Register Auth & Session Lifecycle Adapter
  useEffect(() => {
    const unregisterAuth = SessionLifecycleManager.registerAdapter({
      loadUrl: (url: string) => {
        setAuthUrl(url);
        authWebViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
      },
      injectScript: (script: string) => {
        authWebViewRef.current?.injectJavaScript(script);
      },
      reload: () => {
        authWebViewRef.current?.reload();
      },
    });
    return () => {
      unregisterAuth();
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
    UpdateService.registerBackgroundUpdateTask().catch(() => {});

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
      const isComplete = fraction >= 1;
      const isDownloading = fraction > 0 && fraction < 1;

      setBgDownload((prev) => ({
        isDownloading,
        progress: fraction,
        isComplete,
        versionTag: prev.versionTag,
      }));

      if (isComplete) {
        setUpdateInfo((prev) => (prev ? { ...prev, isCached: true } : prev));
        // If app is currently active in foreground, pop the UpdateModal in READY_TO_INSTALL state
        if (RNAppState.currentState === 'active') {
          setUpdateModalVisible(true);
        }
      }
    });

    // Subscribe to network reachability changes
    const unsubscribeNetwork = NetworkReachabilityService.subscribe((state) => {
      setNetworkState(state);
      if (state === 'CAMPUS_ACTIVE') {
        setIsOffline(false);
        // Auto-resume any interrupted background download on network recovery
        UpdateService.resumePendingDownloadIfAny().catch(() => {});
      } else if (state === 'OFFLINE') {
        setIsOffline(true);
      }
    });

    // Listen to AppState active events for cold/background resumption
    const appStateSubscription = RNAppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        UpdateService.resumePendingDownloadIfAny().catch(() => {});
        checkAppUpdates();
      }
    });

    checkAppUpdates();

    return () => {
      unsubscribeNotification();
      unsubscribeProgress();
      unsubscribeNetwork();
      appStateSubscription.remove();
    };
  }, []);

  const checkAppUpdates = async () => {
    try {
      const info = await UpdateService.checkForUpdate();
      if (info.hasUpdate) {
        setUpdateInfo(info);
        setBgDownload((prev) => ({
          ...prev,
          versionTag: info.latestVersion,
          isComplete: !!info.isCached,
        }));

        // Proactively prefetch update in background if not yet cached so install is instantaneous
        if (!info.isCached && info.apkDownloadUrl && !UpdateService.isDownloading(info.latestVersion)) {
          UpdateService.downloadApk(info.apkDownloadUrl, info.latestVersion, info.apkSizeBytes).catch(() => {});
        } else {
          // Resume any pending interrupted background download seamlessly
          UpdateService.resumePendingDownloadIfAny().catch(() => {});
        }

        const isSnoozed = await UpdateService.isUpdateSnoozed(info.latestVersion);
        if (!isSnoozed && !info.isCached) {
          setUpdateModalVisible(true);
        }
      } else {
        setUpdateInfo(null);
        setBgDownload({
          isDownloading: false,
          progress: 0,
          isComplete: false,
          versionTag: '',
        });
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
          // Pre-warm attendance session in background while LockScreen is active
          syncScopeRef.current = 'ATTENDANCE';
          setSyncScope('ATTENDANCE');
          setSyncUrl('https://shiksha.iiserb.ac.in/secure/studentMyCourses');
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
    // Load local cache to immediately show dashboards offline
    const cachedProfile = await CacheService.getCachedProfileData();
    const cachedAttendance = await CacheService.getCachedAttendanceData();
    const cachedDetails = await CacheService.getCachedCourseDetails();
    
    if (cachedProfile) {
      setProfileData(cachedProfile);
    }
    if (cachedAttendance) {
      setAttendanceData(cachedAttendance);
      const submittedSrs = await CacheService.getSubmittedSrsCourses();
      // Map attendance item list back to registered course structures
      const mappedCourses = cachedAttendance.items.map(item => ({
        courseCode: item.courseCode,
        courseTitle: item.courseTitle,
        instructor: item.instructor,
        srsStatus: {
          ...item.srsStatus,
          midSemAvailable: !!item.srsStatus?.midSemAvailable,
          endSemAvailable: !!item.srsStatus?.endSemAvailable,
          isSubmitted: submittedSrs.includes(item.courseCode) || !!item.srsStatus?.isSubmitted
        }
      }));
      setCourses(mappedCourses);
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
      startSync('ALL');
    }
  };

  const checkOfflineStatus = async (): Promise<boolean> => {
    // Fast probe against Shiksha portal (< 2000ms)
    const reachable = await NetworkReachabilityService.isShikshaReachable(2000);
    return !reachable;
  };

  const finishSync = () => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    if (pageScrapeTimeoutRef.current) clearTimeout(pageScrapeTimeoutRef.current);
    setSyncActive(false);
    setRefreshing(false);
    if (syncResolverRef.current) {
      syncResolverRef.current();
      syncResolverRef.current = null;
    }
  };

  const startSync = async (scope: SyncScope = 'ALL', priorityCourseCode?: string, isUserInitiated = false): Promise<void> => {
    const creds = await SecureStorageService.getCredentials();
    if (!creds) {
      setAppState('NEEDS_LOGIN');
      finishSync();
      return;
    }
    setCredentials(creds);

    console.log(`Starting portal sync [scope: ${scope}${priorityCourseCode ? `, priority: ${priorityCourseCode}` : ''}]...`);
    syncScopeRef.current = scope;
    priorityCourseCodeRef.current = priorityCourseCode || '';
    setSyncScope(scope);
    setSyncActive(true);

    return new Promise<void>((resolve) => {
      syncResolverRef.current = resolve;

      // Timeout safety guard - 30 seconds maximum
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(async () => {
        console.log(`Sync timed out after 30s [scope: ${syncScopeRef.current}]`);
        const isReachable = await NetworkReachabilityService.isShikshaReachable(2500);
        if (isReachable) {
          // Shiksha IS reachable on campus Wi-Fi, but the session was slow or needed re-auth
          console.log('[PortalSyncEngine] Shiksha is reachable. Attempting silent session recovery on timeout...');
          finishSync();
          handleSessionRecoveryAndRetry().catch(() => {});
          return;
        }

        const failedState = await NetworkReachabilityService.recordFailure('Sync timed out');
        finishSync();
        if (isUserInitiated) {
          if (failedState === 'EXTERNAL_ONLINE') {
            Alert.alert(
              'Campus Network Required',
              'Sync timed out. Please check your connection to IISERB Wi-Fi or FortiClient VPN (gateway.iiserb.ac.in).',
              [
                { text: 'Launch FortiClient', onPress: () => CampusConnectionHelper.launchFortiClient() },
                { text: 'Wi-Fi Settings', onPress: () => CampusConnectionHelper.openWifiSettings() },
                { text: 'OK', style: 'cancel' },
              ]
            );
          } else {
            Alert.alert('Offline Mode', 'Cannot sync portal data. Please check your internet connection.');
          }
        }
      }, 30000);

      // Direct Session Navigation: Navigate directly to target secure page on warm sync WebView
      let targetUrl = 'https://shiksha.iiserb.ac.in/secure/studenthome';
      if (scope === 'ATTENDANCE' || scope === 'COURSES' || scope === 'MARKS') {
        targetUrl = 'https://shiksha.iiserb.ac.in/secure/studentMyCourses';
      } else if (scope === 'REPORTS') {
        targetUrl = 'https://shiksha.iiserb.ac.in/secure/studentReports';
      }

      setSyncUrl(targetUrl);
      syncWebViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(targetUrl)}; true;`);
    });
  };

  const handleManualRefresh = async (scope: SyncScope = 'ATTENDANCE') => {
    setSyncScope(scope);
    setRefreshing(true);
    try {
      await startSync(scope, undefined, true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefreshMarks = (courseCode: string): Promise<any> => {
    return new Promise((resolve) => {
      marksResolveMapRef.current[courseCode] = resolve;
      startSync('MARKS', courseCode, true);
    });
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
    startSync();
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

  const handleSubmitSrs = async (course: Course, formData: SrsFormData): Promise<boolean> => {
    try {
      // Build portal payload structure
      let payload: any = {
        courseNumber: course.courseCode,
      };

      if (!formData.isLab) {
        payload.general = {
          response: {
            '1': formData.general.q1 || 'yes',
            '2': formData.general.q2 || 'yes',
            '3': formData.general.q3 || 'yes',
            '4': formData.general.q4 || 'yes',
            aspects: formData.general.aspects || '',
            suggestion: formData.general.suggestion || '',
          },
        };
        payload.course = {
          response: {
            '1': formData.evaluation.q1 || 'yes',
            '2': formData.evaluation.q2 || 'yes',
            '3': formData.evaluation.q3 || 'yes',
            '4': formData.evaluation.q4 || 'yes',
            '5': formData.evaluation.q5 || 'yes',
          },
        };
        payload.selfForCourse = {
          response: {
            '1': formData.selfEvaluation.q1 || 'yes',
            '2': formData.selfEvaluation.q2 || 'yes',
            '3': formData.selfEvaluation.q3 || 'yes',
            '4': formData.selfEvaluation.q4 || 'yes',
            '5': formData.selfEvaluation.q5 || 'yes',
          },
        };
      } else {
        payload.general = {
          response: {
            aspects: formData.general.aspects || '',
            suggestion: formData.general.suggestion || '',
          },
        };
        payload.course = {
          response: {
            '1': formData.evaluation.q1 || 'yes',
            '2': formData.evaluation.q2 || 'yes',
            '3': formData.evaluation.q3 || 'yes',
            '4': formData.evaluation.q4 || 'yes',
          },
        };
        payload.selfForCourse = {
          response: {
            '1': formData.selfEvaluation.q1 || 'yes',
            '2': formData.selfEvaluation.q2 || 'yes',
            '3': formData.selfEvaluation.q3 || 'yes',
          },
        };
      }

      // Inject submission script into sync WebView session
      const isMidSem = formData.surveyType === 'mid_sem';
      const script = ScraperService.getSrsSubmissionScript(payload, isMidSem);
      if (syncWebViewRef.current) {
        syncWebViewRef.current.injectJavaScript(script);
      }

      // Mark locally as submitted in Cache & state optimistically
      await CacheService.markCourseSrsSubmitted(course.courseCode);
      setCourses((prevCourses) =>
        prevCourses.map((c) =>
          c.courseCode === course.courseCode
            ? {
                ...c,
                srsStatus: {
                  ...c.srsStatus,
                  isSubmitted: true,
                  midSemAvailable: false,
                  endSemAvailable: false,
                },
              }
            : c
        )
      );

      Alert.alert(
        'SRS Submitted 🎉',
        `Thank you for your feedback! Your Student Reaction Survey for ${course.courseCode} (${course.courseTitle}) has been submitted successfully.`
      );

      return true;
    } catch (e: any) {
      console.error('Error submitting SRS:', e);
      Alert.alert('Submission Error', 'Failed to submit survey. Please try again.');
      return false;
    }
  };  // Track current sync URL so onLoadEnd knows which page finished loading
  const syncCurrentUrl = useRef<string>('');
  const isRecoveringSession = useRef<boolean>(false);

  const handleSessionRecoveryAndRetry = async () => {
    if (isRecoveringSession.current) return;
    isRecoveringSession.current = true;
    console.log('[PortalSyncEngine] Active portal session invalidated on server. Attempting silent session recovery...');

    try {
      const recovered = await SessionLifecycleManager.silentReauthenticate();
      if (recovered) {
        console.log('[PortalSyncEngine] Silent session recovery succeeded! Retrying sync with refreshed session cookies...');
        isRecoveringSession.current = false;
        
        let targetUrl = 'https://shiksha.iiserb.ac.in/secure/studenthome';
        if (syncScopeRef.current === 'ATTENDANCE' || syncScopeRef.current === 'COURSES' || syncScopeRef.current === 'MARKS') {
          targetUrl = 'https://shiksha.iiserb.ac.in/secure/studentMyCourses';
        } else if (syncScopeRef.current === 'REPORTS') {
          targetUrl = 'https://shiksha.iiserb.ac.in/secure/studentReports';
        }

        setSyncUrl(targetUrl);
        syncWebViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(targetUrl)}; true;`);
      } else {
        console.warn('[PortalSyncEngine] Silent session recovery failed. Portal credentials may have changed.');
        isRecoveringSession.current = false;
        finishSync();
        setAppState('NEEDS_LOGIN');
      }
    } catch (e) {
      console.warn('[PortalSyncEngine] Error during silent recovery:', e);
      isRecoveringSession.current = false;
      finishSync();
    }
  };

  // WebView scraping execution coordinators
  const handleSyncNavigationStateChange = (navState: any) => {
    const { url } = navState;
    syncCurrentUrl.current = url || '';
    console.log('Sync WebView URL:', url);

    // If redirected to login while sync is active, server invalidated the session
    if (url && (url.includes('/login') || url.includes('ldap_login_progress')) && syncActive) {
      if (!isRecoveringSession.current) {
        handleSessionRecoveryAndRetry();
      }
    }
  };

  // Inject scrapers immediately upon page load (Angular readiness is polled dynamically)
  const handleSyncLoadEnd = () => {
    const url = syncCurrentUrl.current;
    if (!url) return;

    if (pageScrapeTimeoutRef.current) {
      clearTimeout(pageScrapeTimeoutRef.current);
    }

    if (url.includes('/login') || url.includes('ldap_login_progress')) {
      if (syncActive && !isRecoveringSession.current) {
        handleSessionRecoveryAndRetry();
      }
      return;
    }

    if (url.includes('/secure')) {
      NetworkReachabilityService.recordSuccess();
      setNetworkState('CAMPUS_ACTIVE');
      setIsOffline(false);
    }

    if (url.includes('/secure/studenthome')) {
      if (syncScopeRef.current === 'ATTENDANCE' || syncScopeRef.current === 'COURSES' || syncScopeRef.current === 'MARKS') {
        // Redirect directly if landed on home after auth but requested courses/attendance/marks
        syncWebViewRef.current?.injectJavaScript(`window.location.href = "https://shiksha.iiserb.ac.in/secure/studentMyCourses"; true;`);
      } else if (syncScopeRef.current === 'REPORTS') {
        // Redirect directly if landed on home after auth but requested reports
        syncWebViewRef.current?.injectJavaScript(`window.location.href = "https://shiksha.iiserb.ac.in/secure/studentReports"; true;`);
      } else {
        console.log('Injected profile scraper (dynamic polling).');
        syncWebViewRef.current?.injectJavaScript(ScraperService.getProfileScraperScript());
      }
    } else if (url.includes('/secure/studentMyCourses')) {
      const knownRoll = profileData?.roll || credentials?.username || '';
      if (syncScopeRef.current === 'COURSES') {
        console.log('Injected courses metadata scraper (dynamic polling).');
        syncWebViewRef.current?.injectJavaScript(ScraperService.getCoursesScraperScript());
      } else if (syncScopeRef.current === 'MARKS') {
        console.log('Injected priority marks scraper (dynamic polling).');
        const allCodes = courses.map((c) => c.courseCode);
        syncWebViewRef.current?.injectJavaScript(
          ScraperService.getCourseMarksScraperScript(priorityCourseCodeRef.current, allCodes, knownRoll)
        );
      } else {
        console.log('Injected attendance scraper (dynamic polling).');
        syncWebViewRef.current?.injectJavaScript(ScraperService.getAttendanceScraperScript(knownRoll));
      }
    } else if (url.includes('/secure/studentReports')) {
      console.log('Injected reports scraper (dynamic polling).');
      syncWebViewRef.current?.injectJavaScript(ScraperService.getReportsScraperScript());
    }
  };

  const handleSyncMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('Sync message received:', data.type);

      if (ReportsService.handlePdfMessage(data)) {
        return;
      }

      if (data.type === 'PROFILE_SCRAPED') {
        if (data.status === 'success') {
          NetworkReachabilityService.recordSuccess();
          setNetworkState('CAMPUS_ACTIVE');
          setIsOffline(false);
          const profile: ProfileData = {
            name: data.name,
            roll: data.roll,
            dept: data.dept,
            passedCourses: data.passedCourses || [],
            failedCourses: data.failedCourses || [],
            performance: data.performance || [],
            photoUrl: data.photoUrl,
            photoBase64: data.photoBase64,
          };
          setProfileData(profile);
          await CacheService.cacheProfileData(profile);

          // If reports were embedded in student profile data, cache them immediately
          if (Array.isArray(data.reports) && data.reports.length > 0) {
            const normalizedReports = data.reports.map((r: any, idx: number) => {
              let fileUrl = r.file || '';
              if (fileUrl && fileUrl.indexOf('http') !== 0) {
                fileUrl = fileUrl.indexOf('/') === 0 ? 'https://shiksha.iiserb.ac.in' + fileUrl : 'https://shiksha.iiserb.ac.in/' + fileUrl;
              }
              const type = (r.type || 'Grade Report').trim();
              const sem = (r.sem || '').trim();
              const annotation = (r.annotation || (type + (sem ? ' (' + sem + ')' : ''))).trim();
              const safeId = (sem + '-' + type).toLowerCase().replace(/[^a-z0-9_-]/g, '_') || ('report_' + idx);
              return {
                id: safeId,
                type: type,
                sem: sem,
                annotation: annotation,
                file: fileUrl,
                show: r.show !== false
              };
            }).filter((r: any) => r.file && r.file.length > 0);

            if (normalizedReports.length > 0) {
              await CacheService.cacheReportsData(normalizedReports);
            }
          }

          if (syncScopeRef.current === 'PROFILE') {
            console.log('Scoped PROFILE sync completed successfully.');
            finishSync();
          } else {
            // Full sync cascade: transition WebView to courses page
            if (pageScrapeTimeoutRef.current) clearTimeout(pageScrapeTimeoutRef.current);
            setSyncUrl('https://shiksha.iiserb.ac.in/secure/studentMyCourses');
          }
        } else {
          console.log('Profile scrape failed:', data.message);
          finishSync();
        }
      } 
      
      else if (data.type === 'ATTENDANCE_SCRAPED') {
        if (data.status === 'success') {
          NetworkReachabilityService.recordSuccess();
          setNetworkState('CAMPUS_ACTIVE');
          setIsOffline(false);
          const attendance: AttendanceData = {
            items: data.items,
            timestamp: new Date().toISOString()
          };
          
          setAttendanceData(attendance);
          await CacheService.cacheAttendanceData(attendance);
          await CacheService.setLastSyncTime(Date.now());
          
          const submittedSrs = await CacheService.getSubmittedSrsCourses();
          // Map courses
          const mappedCourses = (data.items || []).map((item: any) => ({
            courseCode: item.courseCode,
            courseTitle: item.courseTitle,
            instructor: item.instructor,
            srsStatus: {
              ...item.srsStatus,
              midSemAvailable: !!item.srsStatus?.midSemAvailable,
              endSemAvailable: !!item.srsStatus?.endSemAvailable,
              isSubmitted: submittedSrs.includes(item.courseCode) || !!item.srsStatus?.isSubmitted
            }
          }));
          setCourses(mappedCourses);

          if (syncScopeRef.current === 'ATTENDANCE') {
            console.log('Scoped ATTENDANCE sync completed successfully.');
            finishSync();
          } else {
            // Full sync cascade: transition WebView to reports page
            if (pageScrapeTimeoutRef.current) clearTimeout(pageScrapeTimeoutRef.current);
            setSyncUrl('https://shiksha.iiserb.ac.in/secure/studentReports');
          }
        } else {
          console.log('Attendance scrape failed:', data.message);
          finishSync();
        }
      }

      else if (data.type === 'COURSES_SCRAPED') {
        if (data.status === 'success') {
          NetworkReachabilityService.recordSuccess();
          setNetworkState('CAMPUS_ACTIVE');
          setIsOffline(false);
          const submittedSrs = await CacheService.getSubmittedSrsCourses();
          const mappedCourses = (data.items || []).map((item: any) => ({
            courseCode: item.courseCode,
            courseTitle: item.courseTitle,
            instructor: item.instructor,
            srsStatus: {
              ...item.srsStatus,
              midSemAvailable: !!item.srsStatus?.midSemAvailable,
              endSemAvailable: !!item.srsStatus?.endSemAvailable,
              isSubmitted: submittedSrs.includes(item.courseCode) || !!item.srsStatus?.isSubmitted
            }
          }));
          setCourses(mappedCourses);

          if (data.courseDetails) {
            setCourseDetails((prev) => ({ ...prev, ...data.courseDetails }));
            await CacheService.cacheCourseDetails({ ...courseDetails, ...data.courseDetails });
          }

          console.log('Scoped COURSES sync completed successfully.');
        } else {
          console.log('Courses scrape notice:', data.message);
        }
        finishSync();
      }

      else if (data.type === 'COURSE_MARKS_STREAMED') {
        NetworkReachabilityService.recordSuccess();
        setNetworkState('CAMPUS_ACTIVE');
        setIsOffline(false);
        if (data.courseCode && data.marksData) {
          await CacheService.cacheCourseMarks(data.courseCode, data.marksData);
          if (marksResolveMapRef.current[data.courseCode]) {
            marksResolveMapRef.current[data.courseCode](data.marksData);
            delete marksResolveMapRef.current[data.courseCode];
          }
        }
      }

      else if (data.type === 'ALL_COURSE_MARKS_SCRAPED') {
        NetworkReachabilityService.recordSuccess();
        console.log('All course marks scraped & cached.');
        if (syncScopeRef.current === 'MARKS') {
          finishSync();
        }
      }
      
      else if (data.type === 'REPORTS_SCRAPED') {
        if (data.status === 'success') {
          NetworkReachabilityService.recordSuccess();
          setNetworkState('CAMPUS_ACTIVE');
          setIsOffline(false);
          await CacheService.cacheReportsData(data.items || []);
          console.log('Reports sync completed successfully! Total items:', data.items?.length);
        } else {
          console.log('Reports scrape notice:', data.message);
        }
        finishSync();
      }

      else if (data.type === 'ERROR') {
        console.log('Scraper notice/error:', data.message);
        // Ignore stale page scope errors during transition between courses and reports
        if (data.message && data.message.includes('Angular body scope not initialized') && syncCurrentUrl.current.includes('/secure/studentReports')) {
          return;
        }
        if (!isRecoveringSession.current) {
          handleSessionRecoveryAndRetry();
        } else {
          finishSync();
        }
      }
    } catch (e) {
      console.log('Error parsing sync WebView message:', e);
    }
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
                onRefreshPortal={() => startSync('REPORTS')}
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
              networkState={networkState}
            />
          </View>

          {/* Tab 2: Courses */}
          <View key="courses_page" style={styles.pageContainer}>
            <CoursesScreen 
              courses={courses} 
              courseDetails={courseDetails}
              onNavigateToTab={(tab) => handleTabPress(tab as TabName)}
              onOpenSrs={handleOpenSrs}
              onSubmitSrs={handleSubmitSrs}
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
        onPressOpenModal={() => setUpdateModalVisible(true)}
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

      {/* Persistent Auth & Session WebView for SessionLifecycleManager */}
      <View 
        style={{ position: 'absolute', bottom: 0, right: 0, width: 1, height: 1, opacity: 0.01 }} 
        pointerEvents="none"
      >
        <WebView
          ref={authWebViewRef}
          source={{ uri: authUrl }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          originWhitelist={['*']}
          onMessage={(e) => {
            try {
              const data = JSON.parse(e.nativeEvent.data);
              SessionLifecycleManager.handleWebViewMessage(data);
            } catch (err) {}
          }}
          onNavigationStateChange={(navState) => {
            SessionLifecycleManager.handleNavigationStateChange(navState.url);
          }}
          onLoadEnd={(e) => {
            SessionLifecycleManager.handleLoadEnd(e.nativeEvent.url || authUrl);
          }}
          onError={(e) => {
            SessionLifecycleManager.handleAuthError(e.nativeEvent.description);
          }}
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode >= 500) {
              SessionLifecycleManager.handleAuthError(`Server Error: ${e.nativeEvent.statusCode}`);
            }
          }}
          userAgent="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36"
        />
      </View>

      {/* Background WebView for syncing data (Permanently warm in background) */}
      <View 
        style={{ position: 'absolute', bottom: 0, right: 0, width: 1, height: 1, opacity: 0.01 }} 
        pointerEvents="none"
      >
        <WebView
          ref={syncWebViewRef}
          source={{ uri: syncUrl }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          originWhitelist={['*']}
          onMessage={handleSyncMessage}
          onNavigationStateChange={handleSyncNavigationStateChange}
          onLoadEnd={handleSyncLoadEnd}
          onError={async (e) => {
            console.warn('Sync WebView error:', e.nativeEvent.description);
            const isReachable = await NetworkReachabilityService.isShikshaReachable(2000);
            if (!isReachable) {
              const failedState = await NetworkReachabilityService.recordFailure(e.nativeEvent.description);
              finishSync();
              if (failedState === 'EXTERNAL_ONLINE' && syncActive) {
                Alert.alert(
                  'Campus Network Required',
                  'Cannot reach Shiksha portal. Please ensure you are connected to IISERB Wi-Fi or FortiClient VPN (gateway.iiserb.ac.in).',
                  [
                    { text: 'Launch FortiClient', onPress: () => CampusConnectionHelper.launchFortiClient() },
                    { text: 'Wi-Fi Settings', onPress: () => CampusConnectionHelper.openWifiSettings() },
                    { text: 'OK', style: 'cancel' },
                  ]
                );
              }
            } else {
              finishSync();
            }
          }}
          onHttpError={async (e) => {
            if (e.nativeEvent.statusCode >= 500) {
              console.warn('Sync WebView HTTP error:', e.nativeEvent.statusCode);
              await NetworkReachabilityService.recordFailure(`Server error ${e.nativeEvent.statusCode}`);
              finishSync();
            }
          }}
          injectedJavaScriptBeforeContentLoaded={ScraperService.getEarlyInterceptScript()}
          userAgent="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36"
        />
      </View>

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
