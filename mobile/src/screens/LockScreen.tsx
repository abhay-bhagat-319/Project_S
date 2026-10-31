import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { MortarboardLogo } from '../components/MortarboardLogo';
import { SecureStorageService } from '../services/SecureStorageService';
import { CacheService } from '../services/CacheService';
import { SessionLifecycleManager } from '../services/SessionLifecycleManager';

interface LockScreenProps {
  onUnlock: () => void;
  onResetToLogin?: () => void;
}

export default function LockScreen({ onUnlock, onResetToLogin }: LockScreenProps) {
  const insets = useSafeAreaInsets();
  const [hasBiometrics, setHasBiometrics] = useState(false);

  useEffect(() => {
    checkDeviceSupport();
  }, []);

  const checkDeviceSupport = async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supported = hasHardware && isEnrolled;
    setHasBiometrics(supported);
    
    if (supported) {
      triggerBiometricAuth();
    }
  };

  const triggerBiometricAuth = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Student Portal',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (result.success) {
        onUnlock();
      } else {
        if (result.error !== 'user_cancel' && result.error !== 'app_cancel') {
          Alert.alert('Authentication Failed', 'Unable to verify biometric or device credential.');
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.log('Biometric error:', error);
      }
    }
  };

  /**
   * Never allow bypassing the lock screen without authentication if OS biometrics are removed.
   * Instead, wipe stored credentials/cache and require fresh LDAP password authentication.
   */
  const handleRequirePasswordRelogin = async () => {
    await SecureStorageService.setBiometricsEnabled(false);
    await SecureStorageService.clearCredentials();
    await CacheService.clearCache();
    SessionLifecycleManager.purgeSession().catch(() => {});
    if (onResetToLogin) {
      onResetToLogin();
    }
  };

  return (
    <View 
      style={[
        styles.container, 
        { 
          paddingTop: Math.max(40, insets.top + 30),
          paddingBottom: Math.max(40, insets.bottom + 30) 
        }
      ]}
    >
      <View style={styles.logoContainer}>
        <View style={styles.iconCircle}>
          <MortarboardLogo size={68} color={Theme.colors.primary} />
        </View>
        <Text style={styles.title}>Shiksha Portal</Text>
        <Text style={styles.subtitle}>Secure Mobile Access</Text>
      </View>

      <View style={styles.actionContainer}>
        {hasBiometrics ? (
          <TouchableOpacity style={styles.biometricBtn} onPress={triggerBiometricAuth}>
            <Ionicons name="finger-print" size={48} color={Theme.colors.textPrimary} />
            <Text style={styles.btnText}>Authenticate with Biometrics</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.fallbackBtn} onPress={handleRequirePasswordRelogin}>
            <Text style={styles.fallbackText}>Biometrics Unavailable — Sign In with Password</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    justifyContent: 'space-between',
    paddingVertical: 80,
    paddingHorizontal: Theme.spacing.padding,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    fontFamily: 'System',
  },
  subtitle: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    marginTop: 6,
  },
  actionContainer: {
    alignItems: 'center',
  },
  biometricBtn: {
    alignItems: 'center',
    padding: Theme.spacing.padding,
  },
  btnText: {
    color: Theme.colors.textPrimary,
    fontSize: 14,
    marginTop: Theme.spacing.gap,
    fontWeight: '500',
  },
  fallbackBtn: {
    backgroundColor: Theme.colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: Theme.radii.pill,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  fallbackText: {
    color: Theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
});
