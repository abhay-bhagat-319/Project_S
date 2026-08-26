import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../Theme';
import { ScraperService } from '../services/ScraperService';
import { SecureStorageService } from '../services/SecureStorageService';

interface LoginScreenProps {
  onSuccess: (username: string) => void;
}

export default function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [triggerVerify, setTriggerVerify] = useState(false);
  
  const webViewRef = useRef<WebView>(null);
  const loginUrl = 'https://shiksha.iiserb.ac.in/login/';

  const handleLogin = () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Required Fields', 'Please enter both username and password.');
      return;
    }
    setLoading(true);
    setLoadingMessage('Initializing connection to portal...');
    setTriggerVerify(true);
  };

  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'LOGIN_SUBMITTED') {
        setLoadingMessage('Verifying credentials on portal...');
      } else if (data.type === 'ERROR') {
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
    console.log('WebView URL changed to:', url);

    // If navigated to secure home, auth is successful!
    if (url.includes('/secure/studenthome') || url.includes('/secure/studentMyCourses')) {
      await SecureStorageService.saveCredentials(username.trim(), password.trim());
      setLoading(false);
      setTriggerVerify(false);
      onSuccess(username.trim());
    } else if (url.includes('/login') && !loading && triggerVerify) {
      // If we are redirected back to login page during validation, it implies invalid credentials
      setLoading(false);
      setTriggerVerify(false);
      Alert.alert('Authentication Failed', 'Invalid username or password.');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
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

        {/* Hidden WebView for background verification */}
        {triggerVerify && (
          <View style={{ position: 'absolute', left: -1000, top: -1000, width: 100, height: 100 }}>
            <WebView
              ref={webViewRef}
              source={{ uri: loginUrl }}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              onMessage={handleWebViewMessage}
              onNavigationStateChange={handleNavigationStateChange}
              injectedJavaScript={ScraperService.getLoginInjectionScript(username, password)}
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
