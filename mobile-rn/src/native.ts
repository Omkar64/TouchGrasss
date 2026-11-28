import { NativeModules, Platform } from 'react-native';

// This is the JavaScript contract for TouchGrassAndroidModule.kt.
// Keep the return shapes in sync with the values resolved by the Kotlin Promise methods.
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
// Expo Go and non-Android builds do not contain this project-specific native module.
const unavailable = async (): Promise<never> => { throw new Error('TouchGrass native Android services are missing from this build. Install the React Native development build with `npx expo run:android`; Expo Go does not include the native bridge.'); };

// Centralize native calls so screens/hooks do not access NativeModules directly.
// Optional chaining gives callers a clear rejection instead of an undefined-method crash.
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
