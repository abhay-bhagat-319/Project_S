import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { SessionLifecycleManager } from '../services/SessionLifecycleManager';
import { NetworkReachabilityService, NetworkState, IISERB_VPN_CONFIG } from '../services/NetworkReachabilityService';
import { CampusConnectionHelper } from '../utils/CampusConnectionHelper';

interface LoginScreenProps {
  onSuccess: (username: string) => void;
}

export default function LoginScreen({ onSuccess }: LoginScreenProps) {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [networkState, setNetworkState] = useState<NetworkState | 'CHECKING'>('CHECKING');

  useEffect(() => {
    const unsubscribe = NetworkReachabilityService.subscribe((state) => {
      setNetworkState(state);
    });
    return unsubscribe;
  }, []);

  const refreshNetworkStatus = async () => {
    setNetworkState('CHECKING');
    const state = await NetworkReachabilityService.getNetworkState(true);
    setNetworkState(state);
  };

  const handleLogin = async () => {
    const trimmedUser = username.trim();
    const trimmedPass = password.trim();

    if (!trimmedUser || !trimmedPass) {
      Alert.alert('Required Fields', 'Please enter both username and password.');
      return;
    }

    setLoading(true);
    setLoadingMessage('Verifying credentials with Shiksha portal...');

    try {
      const result = await SessionLifecycleManager.authenticate(trimmedUser, trimmedPass);

      if (result.success) {
        setLoading(false);
        onSuccess(trimmedUser);
      } else {
        setLoading(false);
        if (result.code === 'CAMPUS_NETWORK_REQUIRED') {
          setNetworkState('EXTERNAL_ONLINE');
          Alert.alert(
            'Campus Network Required',
            'Shiksha portal is accessible only on IISERB Wi-Fi or via FortiClient VPN (gateway.iiserb.ac.in). Please connect and try again.',
            [
              { text: 'Launch FortiClient', onPress: () => CampusConnectionHelper.launchFortiClient() },
              { text: 'Wi-Fi Settings', onPress: () => CampusConnectionHelper.openWifiSettings() },
              { text: 'OK', style: 'cancel' },
            ]
          );
        } else {
          Alert.alert(
            result.code === 'AUTH_FAILED' ? 'Authentication Failed' : 'Connection Notice',
            result.message || 'Invalid username or password.'
          );
        }
      }
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Connection Notice', e?.message || 'Unable to connect to portal. Please try again.');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView 
        contentContainerStyle={[
          styles.scrollContainer, 
          { 
            paddingTop: Math.max(Theme.spacing.padding, insets.top + 20),
            paddingBottom: Math.max(Theme.spacing.padding, insets.bottom + 20) 
          }
        ]} 
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="lock-closed" size={32} color={Theme.colors.primary} />
          </View>
          <Text style={styles.title}>Welcome to Shiksha</Text>
          <Text style={styles.subtitle}>Log in using your IISERB LDAP credentials</Text>
        </View>

        {/* Campus Network Guidance Banner for External Networks */}
        {networkState === 'EXTERNAL_ONLINE' && (
          <View style={styles.campusNoticeCard}>
            <View style={styles.campusNoticeHeader}>
              <Ionicons name="shield-half" size={20} color="#f59e0b" style={{ marginRight: 8 }} />
              <Text style={styles.campusNoticeTitle}>Campus Network Required</Text>
            </View>
            <Text style={styles.campusNoticeText}>
              Shiksha portal requires an active connection to <Text style={styles.boldText}>IISERB Wi-Fi</Text> or the <Text style={styles.boldText}>FortiClient VPN</Text> ({IISERB_VPN_CONFIG.server}).
            </Text>
            <View style={styles.campusNoticeActions}>
              <TouchableOpacity 
                style={styles.vpnActionBtn} 
                onPress={() => CampusConnectionHelper.launchFortiClient()}
                activeOpacity={0.7}
              >
                <Ionicons name="shield-checkmark" size={15} color="#ffffff" style={{ marginRight: 5 }} />
                <Text style={styles.vpnActionBtnText}>Launch FortiClient</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.wifiActionBtn} 
                onPress={() => CampusConnectionHelper.openWifiSettings()}
                activeOpacity={0.7}
              >
                <Ionicons name="wifi" size={15} color={Theme.colors.textPrimary} style={{ marginRight: 5 }} />
                <Text style={styles.wifiActionBtnText}>Wi-Fi</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.recheckBtn} 
                onPress={refreshNetworkStatus}
                activeOpacity={0.7}
              >
                <Ionicons name="refresh" size={15} color={Theme.colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.form}>
          <Text style={styles.label}>LDAP Username</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="person-outline" size={20} color={Theme.colors.textSecondary} style={styles.inputIcon} />
            <TextInput 
              style={styles.input}
              placeholder="e.g. abhay24"
              placeholderTextColor={Theme.colors.textSecondary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="key-outline" size={20} color={Theme.colors.textSecondary} style={styles.inputIcon} />
            <TextInput 
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={Theme.colors.textSecondary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={Theme.colors.primary} />
              <Text style={styles.loadingText}>{loadingMessage}</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
              <Text style={styles.loginBtnText}>Log In</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Theme.spacing.padding,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },
  campusNoticeCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: Theme.radii.card,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    padding: 16,
    marginBottom: 20,
  },
  campusNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  campusNoticeTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#f59e0b',
  },
  campusNoticeText: {
    fontSize: 13,
    color: Theme.colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  boldText: {
    color: Theme.colors.textPrimary,
    fontWeight: '600',
  },
  campusNoticeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vpnActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284c7',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: Theme.radii.widget,
  },
  vpnActionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  wifiActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.surface,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Theme.radii.widget,
  },
  wifiActionBtnText: {
    color: Theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  recheckBtn: {
    width: 36,
    height: 36,
    borderRadius: Theme.radii.widget,
    backgroundColor: Theme.colors.surface,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  form: {
    backgroundColor: Theme.colors.surface,
    padding: 24,
    borderRadius: Theme.radii.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.widget,
    paddingHorizontal: 16,
    marginBottom: 20,
    height: 52,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: Theme.colors.textPrimary,
    fontSize: 15,
  },
  loginBtn: {
    backgroundColor: Theme.colors.primary,
    height: 52,
    borderRadius: Theme.radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  loginBtnText: {
    color: Theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    marginTop: 8,
  },
  loadingText: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
    marginLeft: 12,
  },
});
