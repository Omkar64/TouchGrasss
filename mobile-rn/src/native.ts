import { NativeModules, Platform } from 'react-native';

// Implemented by the Android Kotlin bridge. Keeping the JS API typed makes the
// app usable while the generated Android project is being wired to the module.
type FocusProgress = {
  sessionStartMillis: number;
  sessionTargetMillis: number;
  sessionActive: boolean;
  elapsedSeconds: number;
  remainingSeconds: number;
  pausedMillis: number;
  pausedUntilMillis: number;
};
type FocusStop = { durationSeconds: number; completed: boolean };
type TouchGrassNative = {
  status(): Promise<boolean>;
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  appBlockingStatus(): Promise<{ accessibilityEnabled: boolean; blockingEnabled: boolean }>;
  openAppBlockingSettings(): Promise<boolean>;
  setAppBlockingEnabled(enabled: boolean): Promise<boolean>;
  setUnlockGrants(grants: { targetKey: string; usableAtMillis: number; expiresAtMillis: number }[]): Promise<boolean>;
  focusProgress(userId: string): Promise<FocusProgress>;
  startFocus(userId: string, durationMinutes: number): Promise<FocusProgress>;
  stopFocus(userId: string, complete: boolean): Promise<FocusStop>;
};

const bridge = NativeModules.TouchGrassAndroid as TouchGrassNative | undefined;
const unavailable = async (): Promise<never> => { throw new Error('Android focus services are not connected in this React Native build yet.'); };

export const nativeFocus = {
  available: Platform.OS === 'android' && !!bridge,
  status: () => bridge?.status() ?? unavailable(),
  start: () => bridge?.start() ?? unavailable(),
  stop: () => bridge?.stop() ?? unavailable(),
  appBlockingStatus: () => bridge?.appBlockingStatus() ?? unavailable(),
  openAppBlockingSettings: () => bridge?.openAppBlockingSettings() ?? unavailable(),
  setAppBlockingEnabled: (enabled: boolean) => bridge?.setAppBlockingEnabled(enabled) ?? unavailable(),
  setUnlockGrants: (grants: Parameters<TouchGrassNative['setUnlockGrants']>[0]) => bridge?.setUnlockGrants(grants) ?? unavailable(),
  focusProgress: (userId: string) => bridge?.focusProgress(userId) ?? unavailable(),
  startFocus: (userId: string, durationMinutes: number) => bridge?.startFocus(userId, durationMinutes) ?? unavailable(),
  stopFocus: (userId: string, complete: boolean) => bridge?.stopFocus(userId, complete) ?? unavailable(),
};
