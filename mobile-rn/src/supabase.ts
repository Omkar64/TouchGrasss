import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

// Expo public environment variables override the app.json values for local/deployed builds.
const extra = Constants.expoConfig?.extra ?? {};
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? extra.supabasePublishableKey;

if (!url || !key) throw new Error('Supabase URL and publishable key are required.');

// AsyncStorage keeps the login session across app restarts; the publishable key is safe for client use with RLS enabled.
export const supabase = createClient(url, key, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

if (Platform.OS !== 'web') {
  // Supabase token refresh should run only while the mobile app is in the foreground.
  AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
