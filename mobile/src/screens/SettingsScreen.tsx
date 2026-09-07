import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Switch, TextInput, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { SecureStorageService } from '../services/SecureStorageService';
import { CacheService } from '../services/CacheService';
import { ScraperService } from '../services/ScraperService';
import { UpdateService, UpdateInfo } from '../services/UpdateService';

interface SettingsScreenProps {
  onLogout: () => void;
  onCredentialsUpdated: () => void;
  onOpenUpdateModal?: (info: UpdateInfo) => void;
}

export default function SettingsScreen({ onLogout, onCredentialsUpdated, onOpenUpdateModal }: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [triggerVerify, setTriggerVerify] = useState(false);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  const [cacheSize, setCacheSize] = useState<string>('...');

  const webViewRef = useRef<WebView>(null);
  const loginUrl = 'https://shiksha.iiserb.ac.in/login/';

  useEffect(() => {
    loadSettings();
    loadCacheSize();
  }, []);

  const loadCacheSize = async () => {
    try {
      const stats = await CacheService.getCacheStats();
      setCacheSize(stats.formatted);
    } catch {
      setCacheSize('0 KB');
    }
  };

  const loadSettings = async () => {
    const isBioEnabled = await SecureStorageService.isBiometricsEnabled();
    setBiometricsEnabled(isBioEnabled);

    const creds = await SecureStorageService.getCredentials();
    if (creds) {
      setUsername(creds.username);
    }
  };

  const handleToggleBiometrics = async (val: boolean) => {
    setBiometricsEnabled(val);
    await SecureStorageService.setBiometricsEnabled(val);
    Alert.alert('Biometrics Updated', `Biometric unlock has been ${val ? 'enabled' : 'disabled'}.`);
  };

  const handleUpdateCredentials = () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Required Fields', 'Please fill in both LDAP username and password.');
      return;
    }
    setLoading(true);
    setTriggerVerify(true);
  };

  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ERROR') {
        setLoading(false);
        setTriggerVerify(false);
        Alert.alert('Update Failed', data.message || 'An error occurred during verification.');
      }
    } catch (e) {
      console.log('Error parsing WebView message:', e);
    }
  };

  const handleNavigationStateChange = async (navState: any) => {
    const { url } = navState;

    if (url.includes('/secure/studenthome') || url.includes('/secure/studentMyCourses')) {
      // Valid credentials! Save them
      await SecureStorageService.saveCredentials(username.trim(), password.trim());
      setLoading(false);
      setTriggerVerify(false);
      setPassword('');
      setShowUpdateForm(false);
      Alert.alert('Success', 'LDAP credentials updated successfully.');
      onCredentialsUpdated(); // Trigger refetch of profile details
    } else if (url.includes('/login') && !loading && triggerVerify) {
      setLoading(false);
      setTriggerVerify(false);
      Alert.alert('Authentication Failed', 'Invalid username or password. Credentials not updated.');
    }
  };

  const handleClearCache = async () => {
    Alert.alert(
      "Clear Local Cache",
      `Are you sure you want to clear your offline student dashboard, course cache, and downloaded update packages? (${cacheSize})`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Clear", 
          style: "destructive", 
          onPress: async () => {
            await CacheService.clearCache();
            await loadCacheSize();
            Alert.alert("Cache Cleared", "Local offline records and downloaded packages have been wiped.");
          }
        }
      ]
    );
  };

  const handleCheckForUpdates = async () => {
    try {
      setCheckingUpdate(true);
      const info = await UpdateService.checkForUpdate();
      if (info.hasUpdate) {
        if (onOpenUpdateModal) {
          onOpenUpdateModal(info);
        } else {
          Alert.alert(
            'Update Available',
            `Version ${info.latestVersion} is available.`,
            [
              { text: 'Open in Browser', onPress: () => Linking.openURL(info.htmlUrl) },
              { text: 'Later', style: 'cancel' }
            ]
          );
        }
      } else {
        Alert.alert(
          'Up to Date',
          `You are running the latest version of Project_S (v${info.currentVersion}).`
        );
      }
    } catch (e: any) {
      Alert.alert(
        'Check Failed',
        'Could not reach GitHub Releases. Please check your internet connection.'
      );
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out? This will clear all secure credentials and local cached data.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Log Out', 
          style: 'destructive',
          onPress: async () => {
            await SecureStorageService.clearCredentials();
            await CacheService.clearCache();
            onLogout();
          }
        }
      ]
    );
  };

  return (
    <ScrollView 
      style={styles.container} 
      contentContainerStyle={[
        styles.scrollContent, 
        { paddingBottom: Theme.layout.baseScrollBottomPadding + insets.bottom }
      ]}
    >
      
      {/* Security Section */}
      <Text style={styles.sectionTitle}>Security Settings</Text>
      <View style={styles.sectionCard}>
        <View style={styles.settingItem}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingLabel}>Enable Biometric Lock</Text>
            <Text style={styles.settingDescription}>Prompt FaceID/Fingerprint on startup</Text>
          </View>
          <Switch 
            value={biometricsEnabled}
            onValueChange={handleToggleBiometrics}
            trackColor={{ false: '#767577', true: Theme.colors.primary }}
            thumbColor={Theme.colors.textPrimary}
          />
        </View>

        <TouchableOpacity 
          style={[styles.settingItem, styles.borderTop]} 
          onPress={() => setShowUpdateForm(!showUpdateForm)}
        >
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingLabel}>Update LDAP Credentials</Text>
            <Text style={styles.settingDescription}>Change stored student portal password</Text>
          </View>
          <Ionicons 
            name={showUpdateForm ? "chevron-up" : "chevron-down"} 
            size={20} 
            color={Theme.colors.textSecondary} 
          />
        </TouchableOpacity>

        {showUpdateForm && (
          <View style={styles.formContainer}>
            <TextInput 
              style={styles.input}
              placeholder="LDAP Username"
              placeholderTextColor={Theme.colors.textSecondary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
            <TextInput 
              style={styles.input}
              placeholder="New LDAP Password"
              placeholderTextColor={Theme.colors.textSecondary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
            {loading ? (
              <ActivityIndicator size="small" color={Theme.colors.primary} style={styles.spinner} />
            ) : (
              <TouchableOpacity style={styles.saveBtn} onPress={handleUpdateCredentials}>
                <Text style={styles.saveBtnText}>Verify & Save</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Storage & Cache Section */}
      <Text style={styles.sectionTitle}>System Settings</Text>
      <View style={styles.sectionCard}>
        <TouchableOpacity style={styles.settingItem} onPress={handleClearCache} activeOpacity={0.7}>
          <View style={styles.settingTextContainer}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.settingLabel}>Clear Local Cache</Text>
              <View style={styles.sizePill}>
                <Text style={styles.sizePillText}>{cacheSize}</Text>
              </View>
            </View>
            <Text style={styles.settingDescription}>Erase stored dashboards, charts & downloaded update files</Text>
          </View>
          <Ionicons name="trash-outline" size={20} color={Theme.colors.error} />
        </TouchableOpacity>
      </View>

      {/* App & Updates Section */}
      <Text style={styles.sectionTitle}>App & Updates</Text>
      <View style={styles.sectionCard}>
        <View style={styles.settingItem}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingLabel}>App Version</Text>
            <Text style={styles.settingDescription}>Open source student community build</Text>
          </View>
          <View style={styles.versionBadge}>
            <Text style={styles.versionBadgeText}>v{UpdateService.getCurrentVersion()}</Text>
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.settingItem, styles.borderTop]} 
          onPress={handleCheckForUpdates}
          disabled={checkingUpdate}
          activeOpacity={0.7}
        >
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingLabel}>Check for Updates</Text>
            <Text style={styles.settingDescription}>Fetch latest release notes & APK from GitHub</Text>
          </View>
          {checkingUpdate ? (
            <ActivityIndicator size="small" color={Theme.colors.primary} />
          ) : (
            <Ionicons name="cloud-download-outline" size={20} color={Theme.colors.primary} />
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.settingItem, styles.borderTop]} 
          onPress={() => Linking.openURL(UpdateService.RELEASES_WEB_URL)}
          activeOpacity={0.7}
        >
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingLabel}>GitHub Repository</Text>
            <Text style={styles.settingDescription}>View source code, issues & releases</Text>
          </View>
          <Ionicons name="open-outline" size={18} color={Theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Account Section */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color={Theme.colors.textPrimary} style={styles.logoutIcon} />
        <Text style={styles.logoutText}>Log Out from Application</Text>
      </TouchableOpacity>

      {/* Background WebView for verifying updated credentials */}
      {triggerVerify && (
        <View 
          style={{ position: 'absolute', bottom: 0, right: 0, width: 1, height: 1, opacity: 0.01 }} 
          pointerEvents="none"
        >
          <WebView
            ref={webViewRef}
            source={{ uri: loginUrl }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            mixedContentMode="always"
            setSupportMultipleWindows={false}
            originWhitelist={['*']}
            onMessage={handleWebViewMessage}
            onNavigationStateChange={handleNavigationStateChange}
            injectedJavaScript={ScraperService.getLoginInjectionScript(username.trim(), password.trim())}
            userAgent="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36"
          />
        </View>
      )}

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
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.gapTight,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionCard: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.radii.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingHorizontal: Theme.spacing.padding,
    marginBottom: Theme.spacing.gap * 1.5,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
  },
  settingTextContainer: {
    flex: 1,
    marginRight: 10,
  },
  settingLabel: {
    color: Theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  settingDescription: {
    color: Theme.colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  formContainer: {
    paddingBottom: 18,
  },
  input: {
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.widget,
    height: 48,
    color: Theme.colors.textPrimary,
    paddingHorizontal: 16,
    marginBottom: 12,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: Theme.colors.primary,
    height: 44,
    borderRadius: Theme.radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  saveBtnText: {
    color: Theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  spinner: {
    marginTop: 12,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.error,
    height: 52,
    borderRadius: Theme.radii.pill,
    marginTop: 20,
  },
  logoutIcon: {
    marginRight: 8,
  },
  logoutText: {
    color: Theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: 'bold',
  },
  versionBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  versionBadgeText: {
    color: Theme.colors.lavender,
    fontSize: 12,
    fontWeight: '700',
  },
  sizePill: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  sizePillText: {
    color: '#f87171',
    fontSize: 11,
    fontWeight: '700',
  },
});
