import * as SecureStore from 'expo-secure-store';

const KEY_USERNAME = 'shiksha_username';
const KEY_PASSWORD = 'shiksha_password';
const KEY_BIOMETRICS_ENABLED = 'shiksha_biometrics_enabled';

export const SecureStorageService = {
  /**
   * Save student credentials securely
   */
  async saveCredentials(username: string, password: string): Promise<void> {
    await SecureStore.setItemAsync(KEY_USERNAME, username);
    await SecureStore.setItemAsync(KEY_PASSWORD, password);
  },

  /**
   * Retrieve student credentials
   */
  async getCredentials(): Promise<{ username: string; password: string } | null> {
    const username = await SecureStore.getItemAsync(KEY_USERNAME);
    const password = await SecureStore.getItemAsync(KEY_PASSWORD);

    if (username && password) {
      return { username, password };
    }
    return null;
  },

  /**
   * Delete student credentials on logout
   */
  async clearCredentials(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY_USERNAME);
    await SecureStore.deleteItemAsync(KEY_PASSWORD);
  },

  /**
   * Save whether biometric authentication is enabled
   */
  async setBiometricsEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(KEY_BIOMETRICS_ENABLED, enabled ? 'true' : 'false');
  },

  /**
   * Check if biometric authentication is enabled
   */
  async isBiometricsEnabled(): Promise<boolean> {
    const val = await SecureStore.getItemAsync(KEY_BIOMETRICS_ENABLED);
    return val === 'true';
  },
};
