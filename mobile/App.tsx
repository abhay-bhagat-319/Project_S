import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Alert, StatusBar, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';

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

type AppState = 'INITIALIZING' | 'NEEDS_LOGIN' | 'LOCKED' | 'LOGGED_IN';
type TabName = 'Profile' | 'Attendance' | 'Courses' | 'Portal' | 'Settings';

export default function App() {
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

  // Re-authentication Credentials
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);

  const syncWebViewRef = useRef<WebView>(null);

  useEffect(() => {
    bootstrapApp();
  }, []);

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
          };
          setProfileData(profile);
          await CacheService.cacheProfileData(profile);

          // Now transition the WebView to the courses page
          setSyncUrl('https://shiksha.iiserb.ac.in/secure/studentMyCourses');
        } else {
          console.log('Profile scrape failed:', data.message);
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

          console.log('Sync completed successfully!');
          setSyncActive(false);
          setRefreshing(false);
        } else {
          console.log('Attendance scrape failed:', data.message);
          setSyncActive(false);
          setRefreshing(false);
        }
      } 
      
      else if (data.type === 'ERROR') {
        console.log('Scraper error:', data.message);
        setSyncActive(false);
        setRefreshing(false);
      }
    } catch (e) {
      console.log('Error parsing sync WebView message:', e);
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
    <View style={styles.container}>
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
      <View style={styles.navBarWrapper}>
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
            <Ionicons 
              name={activeTab === 'Settings' ? 'settings' : 'settings-outline'} 
              size={20} 
              color={activeTab === 'Settings' ? '#FFFFFF' : Theme.colors.textSecondary} 
            />
          </TouchableOpacity>

        </View>
      </View>

      {/* Background WebView for syncing data */}
      {syncActive && (
        <View style={{ position: 'absolute', left: -9999, top: -9999, width: 390, height: 844 }}>
          <WebView
            ref={syncWebViewRef}
            source={{ uri: syncUrl }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            onMessage={handleSyncMessage}
            onNavigationStateChange={handleSyncNavigationStateChange}
            onLoadEnd={handleSyncLoadEnd}
            injectedJavaScriptBeforeContentLoaded={ScraperService.getEarlyInterceptScript()}
            userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
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
});
