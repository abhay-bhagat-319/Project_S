import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Alert, StatusBar, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';

import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Theme } from './src/Theme';
import { SecureStorageService } from './src/services/SecureStorageService';
import { CacheService, ProfileData, AttendanceData, CourseDetail } from './src/services/CacheService';
import { ScraperService } from './src/services/ScraperService';

import LockScreen from './src/screens/LockScreen';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import CoursesScreen, { Course } from './src/screens/CoursesScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import PortalWebviewScreen from './src/screens/PortalWebviewScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import UpdateModal from './src/screens/UpdateModal';
import BackgroundDownloadPill from './src/components/BackgroundDownloadPill';
import { UpdateService, UpdateInfo } from './src/services/UpdateService';

type AppState = 'INITIALIZING' | 'NEEDS_LOGIN' | 'LOCKED' | 'LOGGED_IN';
type TabName = 'Profile' | 'Attendance' | 'Courses' | 'Portal' | 'Settings';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [appState, setAppState] = useState<AppState>('INITIALIZING');
  const [activeTab, setActiveTab] = useState<TabName>('Profile');
  
  // Scraped Data
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseDetails, setCourseDetails] = useState<Record<string, CourseDetail>>({});
  
  // Sync States
  const [syncActive, setSyncActive] = useState(false);
  const [syncUrl, setSyncUrl] = useState('https://shiksha.iiserb.ac.in/secure/studenthome');
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  
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

  const syncWebViewRef = useRef<WebView>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bootstrapApp();
    checkAppUpdates();
  }, []);

  const checkAppUpdates = async () => {
    try {
      const info = await UpdateService.checkForUpdate();
      if (info.hasUpdate) {
        setUpdateInfo(info);
        const isSnoozed = await UpdateService.isUpdateSnoozed(info.latestVersion);
        if (!isSnoozed) {
          setUpdateModalVisible(true);
        }
      }
    } catch (err) {
      console.log('Startup update check error:', err);
    }
  };

  const handleStartBackgroundDownload = async (info: UpdateInfo) => {
    if (!info.apkDownloadUrl) return;
    setBgDownload({
      isDownloading: true,
      progress: 0,
      isComplete: false,
      versionTag: info.latestVersion,
    });

    try {
      await UpdateService.downloadApk(
        info.apkDownloadUrl,
        info.latestVersion,
        info.apkSizeBytes,
        (fraction) => {
          setBgDownload((prev) => ({ ...prev, progress: fraction }));
        }
      );
      setBgDownload((prev) => ({
        ...prev,
        isDownloading: false,
        isComplete: true,
      }));
      setUpdateInfo((prev) => (prev ? { ...prev, isCached: true } : prev));
      Alert.alert(
        'Update Ready',
        `Project_S v${info.latestVersion} is downloaded and ready to install.`,
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Install Now',
            onPress: () => UpdateService.installCachedApk(info.latestVersion),
          },
        ]
      );
    } catch (err: any) {
      console.error('[App] Background download failed:', err);
      setBgDownload((prev) => ({ ...prev, isDownloading: false }));
      Alert.alert('Download Failed', 'Background download was interrupted. Please retry from Settings.');
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
    // Load local cache to immediately show dashboards offline
    const cachedProfile = await CacheService.getCachedProfileData();
    const cachedAttendance = await CacheService.getCachedAttendanceData();
    const cachedDetails = await CacheService.getCachedCourseDetails();
    
    if (cachedProfile) {
      setProfileData(cachedProfile);
    }
    if (cachedAttendance) {
      setAttendanceData(cachedAttendance);
      // Map attendance item list back to registered course structures
      const mappedCourses = cachedAttendance.items.map(item => ({
        courseCode: item.courseCode,
        courseTitle: item.courseTitle,
        instructor: item.instructor
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
    // Check internet connectivity
    const offline = await checkOfflineStatus();
    if (offline) {
      setIsOffline(true);
      return;
    }
    setIsOffline(false);

    // Check sync cooldown
    const needsSync = await CacheService.isSyncCooledDown();
    if (needsSync) {
      startSync();
    }
  };

  const checkOfflineStatus = async (): Promise<boolean> => {
    try {
      // Fast lightweight fetch to check internet connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      await fetch('https://www.google.com', { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeoutId);
      return false;
    } catch (e) {
      return true;
    }
  };

  const startSync = async () => {
    const offline = await checkOfflineStatus();
    if (offline) {
      setIsOffline(true);
      setRefreshing(false);
      Alert.alert('Offline Mode', 'Cannot sync portal data. Please check your internet connection.');
      return;
    }
    setIsOffline(false);

    const creds = await SecureStorageService.getCredentials();
    if (!creds) {
      setAppState('NEEDS_LOGIN');
      return;
    }
    setCredentials(creds);

    console.log('Starting portal sync...');
    setSyncActive(true);

    // Timeout safety guard - 35 seconds maximum
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      console.log('Sync timed out after 35s');
      setSyncActive(false);
      setRefreshing(false);
    }, 35000);

    // Always start from login so Angular completes its full auth flow.
    setSyncUrl('https://shiksha.iiserb.ac.in/login');
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await startSync();
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
    setActiveTab('Profile');
    setAppState('NEEDS_LOGIN');
  };

  const handleOpenSrs = (courseCode: string) => {
    const srsUrl = `https://shiksha.iiserb.ac.in/secure/studentSRS/${courseCode}`;
    setPortalTargetUrl(srsUrl);
    setActiveTab('Portal');
  };

  // Track current sync URL so onLoadEnd knows which page finished loading
  const syncCurrentUrl = useRef<string>('');

  // WebView scraping execution coordinators
  const handleSyncNavigationStateChange = (navState: any) => {
    const { url } = navState;
    syncCurrentUrl.current = url || '';
    console.log('Sync WebView URL:', url);

    // Inject credentials whenever we land on any login page
    if (url && url.includes('/login')) {
      if (credentials) {
        console.log('Injecting credentials into sync WebView...');
        syncWebViewRef.current?.injectJavaScript(
          ScraperService.getLoginInjectionScript(credentials.username, credentials.password)
        );
      } else {
        setSyncActive(false);
        setRefreshing(false);
        setAppState('NEEDS_LOGIN');
      }
    }
  };

  // Inject scrapers only after the page has fully loaded (Angular bootstrapped)
  const handleSyncLoadEnd = () => {
    const url = syncCurrentUrl.current;
    if (!url) return;

    if (url.includes('/secure/studenthome')) {
      // Delay to allow Angular to finish bootstrapping and populate ng-init
      setTimeout(() => {
        console.log('Injected profile scraper.');
        syncWebViewRef.current?.injectJavaScript(ScraperService.getProfileScraperScript());
      }, 1500);
    } else if (url.includes('/secure/studentMyCourses')) {
      setTimeout(() => {
        console.log('Injected attendance & course details scraper.');
        syncWebViewRef.current?.injectJavaScript(ScraperService.getAttendanceScraperScript());
      }, 1500);
    }
  };

  const handleSyncMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('Sync message received:', data.type);

      if (data.type === 'PROFILE_SCRAPED') {
        if (data.status === 'success') {
          const profile: ProfileData = {
            name: data.name,
            roll: data.roll,
            dept: data.dept,
            passedCourses: data.passedCourses,
            failedCourses: data.failedCourses,
            performance: data.performance,
            photoUrl: data.photoUrl,
            photoBase64: data.photoBase64,
          };
          setProfileData(profile);
          await CacheService.cacheProfileData(profile);

          // Now transition the WebView to the courses page
          setSyncUrl('https://shiksha.iiserb.ac.in/secure/studentMyCourses');
          syncWebViewRef.current?.injectJavaScript(`window.location.href = "https://shiksha.iiserb.ac.in/secure/studentMyCourses"; true;`);
        } else {
          console.log('Profile scrape failed:', data.message);
          if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
          setSyncActive(false);
          setRefreshing(false);
        }
      } 
      
      else if (data.type === 'ATTENDANCE_SCRAPED') {
        if (data.status === 'success') {
          const attendance: AttendanceData = {
            items: data.items,
            timestamp: new Date().toISOString()
          };
          
          setAttendanceData(attendance);
          await CacheService.cacheAttendanceData(attendance);
          await CacheService.setLastSyncTime(Date.now());
          
          // Map courses
          const mappedCourses = data.items.map((item: any) => ({
            courseCode: item.courseCode,
            courseTitle: item.courseTitle,
            instructor: item.instructor
          }));
          setCourses(mappedCourses);

          // Map course details
          if (data.courseDetails) {
            setCourseDetails(data.courseDetails);
            await CacheService.cacheCourseDetails(data.courseDetails);
          }

          // If attendance scrape found photo and profile didn't have base64, augment profileData
          if (data.photoBase64 || data.photoUrl) {
            setProfileData((prev) => {
              if (prev && !prev.photoBase64 && (data.photoBase64 || data.photoUrl)) {
                const updated = {
                  ...prev,
                  photoBase64: data.photoBase64 || prev.photoBase64,
                  photoUrl: data.photoUrl || prev.photoUrl
                };
                CacheService.cacheProfileData(updated);
                return updated;
              }
              return prev;
            });
          }

          console.log('Sync completed successfully!');
          if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
          setSyncActive(false);
          setRefreshing(false);
        } else {
          console.log('Attendance scrape failed:', data.message);
          if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
          setSyncActive(false);
          setRefreshing(false);
        }
      } 
      
      else if (data.type === 'ERROR') {
        console.log('Scraper error:', data.message);
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        setSyncActive(false);
        setRefreshing(false);
      }
    } catch (e) {
      console.log('Error parsing sync WebView message:', e);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      setSyncActive(false);
      setRefreshing(false);
    }
  };

  const renderActiveScreen = () => {
    switch (activeTab) {
      case 'Profile':
        return <DashboardScreen profileData={profileData} />;
      case 'Attendance':
        return (
          <AttendanceScreen 
            attendanceData={attendanceData} 
            onRefresh={handleManualRefresh} 
            refreshing={refreshing}
            isOffline={isOffline}
          />
        );
      case 'Courses':
        return (
          <CoursesScreen 
            courses={courses} 
            courseDetails={courseDetails}
            onNavigateToTab={(tab) => setActiveTab(tab as TabName)}
            onOpenSrs={handleOpenSrs}
          />
        );
      case 'Portal':
        return (
          <PortalWebviewScreen 
            credentials={credentials} 
            targetUrl={portalTargetUrl}
            onClearTargetUrl={() => setPortalTargetUrl(null)}
          />
        );
      case 'Settings':
        return (
          <SettingsScreen 
            onLogout={handleLogoutSuccess} 
            onCredentialsUpdated={bootstrapApp}
            onOpenUpdateModal={(info) => {
              setUpdateInfo(info);
              setUpdateModalVisible(true);
            }}
          />
        );
      default:
        return <DashboardScreen profileData={profileData} />;
    }
  };

  // Render entry layout based on State
  if (appState === 'INITIALIZING') {
    return (
      <View style={styles.initializingContainer}>
        <ActivityIndicator size="large" color={Theme.colors.primary} />
        <Text style={styles.initializingText}>Loading Shiksha Wrapper...</Text>
      </View>
    );
  }

  if (appState === 'LOCKED') {
    return <LockScreen onUnlock={handleUnlockSuccess} />;
  }

  if (appState === 'NEEDS_LOGIN') {
    return <LoginScreen onSuccess={handleLoginSuccess} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
      
      {/* Top Header */}
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

      {/* Screen Content Area */}
      <View style={styles.content}>
        {renderActiveScreen()}
      </View>

      {/* Custom Floating Pill 5-Item Bottom Navigation Bar */}
      <View style={[styles.navBarWrapper, { bottom: Math.max(16, insets.bottom + Theme.layout.navBarBaseBottom) }]}>
        <View style={styles.navBar}>
          
          <TouchableOpacity 
            style={[styles.navItem, activeTab === 'Profile' && styles.activeNavItem]}
            onPress={() => setActiveTab('Profile')}
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
            onPress={() => setActiveTab('Attendance')}
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
            onPress={() => setActiveTab('Courses')}
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
            onPress={() => setActiveTab('Portal')}
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
            onPress={() => setActiveTab('Settings')}
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
        onStartBackgroundDownload={handleStartBackgroundDownload}
        onSnooze={() => {}}
        isBackgroundDownloading={bgDownload.isDownloading}
      />

      {/* Background WebView for syncing data */}
      {syncActive && (
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
            injectedJavaScriptBeforeContentLoaded={ScraperService.getEarlyInterceptScript()}
            userAgent="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36"
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
  navBarWrapper: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
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
});
