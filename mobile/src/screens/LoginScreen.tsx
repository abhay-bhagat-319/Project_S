import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../Theme';
import { ScraperService } from '../services/ScraperService';
import { SecureStorageService } from '../services/SecureStorageService';

interface LoginScreenProps {
  onSuccess: (username: string) => void;
}

export default function LoginScreen({ onSuccess }: LoginScreenProps) {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [triggerVerify, setTriggerVerify] = useState(false);
  
  const webViewRef = useRef<WebView>(null);
  const loginUrl = 'https://shiksha.iiserb.ac.in/login/';

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogin = () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Required Fields', 'Please enter both username and password.');
      return;
    }
    setLoading(true);
    setLoadingMessage('Initializing connection to portal...');
    setTriggerVerify(true);

    // Timeout safety guard - 20 seconds maximum
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setLoading(false);
      setTriggerVerify(false);
      Alert.alert('Connection Timeout', 'Portal verification took too long. Please verify your internet connection or LDAP credentials.');
    }, 20000);
  };

  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'LOGIN_SUBMITTED') {
        setLoadingMessage('Verifying credentials on portal...');
      } else if (data.type === 'AUTH_FAILED') {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setLoading(false);
        setTriggerVerify(false);
        Alert.alert('Authentication Failed', data.message || 'Invalid username or password.');
      } else if (data.type === 'ERROR') {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setLoading(false);
        setTriggerVerify(false);
        Alert.alert('Verification Failed', data.message || 'An error occurred during verification.');
      }
    } catch (e) {
      console.log('Error parsing WebView message:', e);
    }
  };

  const handleNavigationStateChange = async (navState: any) => {
    const { url } = navState;
    console.log('Login WebView URL changed to:', url);

    // If navigated to secure portal area, authentication was successful!
    if (url && (url.includes('/secure/') || url.includes('/secure'))) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      await SecureStorageService.saveCredentials(username.trim(), password.trim());
      setLoading(false);
      setTriggerVerify(false);
      onSuccess(username.trim());
    } else if (url && url.includes('/login') && triggerVerify) {
      // Re-inject script in case page reloaded or navigated to login variant
      webViewRef.current?.injectJavaScript(
        ScraperService.getLoginInjectionScript(username.trim(), password.trim())
      );
    }
  };

  const handleLoadEnd = () => {
    if (triggerVerify) {
      webViewRef.current?.injectJavaScript(
        ScraperService.getLoginInjectionScript(username.trim(), password.trim())
      );
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

        {/* Background verification WebView (attached with 1x1 opacity to prevent Chromium timer throttling in release builds) */}
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
              onLoadEnd={handleLoadEnd}
              onError={(e) => {
                console.warn('Login WebView Error:', e.nativeEvent);
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
                setLoading(false);
                setTriggerVerify(false);
                Alert.alert('Connection Error', e.nativeEvent.description || 'Unable to connect to portal server.');
              }}
              onHttpError={(e) => {
                console.warn('Login WebView HTTP Error:', e.nativeEvent);
                if (e.nativeEvent.statusCode >= 500) {
                  if (timeoutRef.current) clearTimeout(timeoutRef.current);
                  setLoading(false);
                  setTriggerVerify(false);
                  Alert.alert('Portal Server Down', `Shiksha portal returned HTTP ${e.nativeEvent.statusCode}.`);
                }
              }}
              injectedJavaScript={ScraperService.getLoginInjectionScript(username.trim(), password.trim())}
              userAgent="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36"
            />
          </View>
        )}
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
    marginBottom: 40,
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
