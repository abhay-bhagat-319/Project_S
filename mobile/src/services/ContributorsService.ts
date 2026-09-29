import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppConfig } from '../constants/Config';

export interface Contributor {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
}

const CONTRIBUTORS_CACHE_KEY = 'shiksha_cached_github_contributors';

// Default creator profile to ensure it is always loaded offline and highlighted
export const CREATOR_PROFILE = {
  name: 'Abhay Bhagat',
  login: 'abhay-bhagat-319',
  role: 'Project Creator & Lead Maintainer',
  avatar_url: 'https://avatars.githubusercontent.com/u/150064975?v=4',
  html_url: 'https://github.com/abhay-bhagat-319',
  description: 'Initiated Project_S, created the scraper engine, custom offline cache architecture, and native mobile UI.',
};

export class ContributorsService {
  private static API_URL = `https://api.github.com/repos/${AppConfig.GITHUB_OWNER}/${AppConfig.GITHUB_REPO}/contributors`;

  /**
   * Fetches list of contributors from GitHub API with local AsyncStorage caching
   */
  public static async getContributors(): Promise<Contributor[]> {
    try {
      const response = await fetch(ContributorsService.API_URL, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Project_S-App',
        },
      });

      if (response.ok) {
        const data: Contributor[] = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          await AsyncStorage.setItem(CONTRIBUTORS_CACHE_KEY, JSON.stringify(data));
          return data;
        }
      }
    } catch (e) {
      console.log('[ContributorsService] Failed to fetch live contributors:', e);
    }

    // Fallback to cached contributors
    try {
      const cached = await AsyncStorage.getItem(CONTRIBUTORS_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.log('[ContributorsService] Failed to read cached contributors:', e);
    }

    return [];
  }
}
