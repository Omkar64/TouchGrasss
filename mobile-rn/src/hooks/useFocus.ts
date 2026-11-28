import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { nativeFocus } from '../native';
import { emptyProgress, type AppSession, type FocusProgress } from '../types';
import type { Dispatch, SetStateAction } from 'react';

type Feedback = { setNotice: (notice: string) => void };

// Coordinates the local Android VPN/accessibility state with the timed focus session.
export function useFocus(session: AppSession | null, loadSocial: (userId: string) => Promise<void>, { setNotice }: Feedback, progress: FocusProgress, setProgress: Dispatch<SetStateAction<FocusProgress>>) {
  const [grounded, setGrounded] = useState(false);
  const [appBlocking, setAppBlocking] = useState(false);
  const [accessibility, setAccessibility] = useState(false);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [focusMinutes, setFocusMinutes] = useState('25');
  const completingFocus = useRef(false);

  useEffect(() => {
    // A logout clears device-derived state so the next account cannot see the prior session.
    if (session) return;
    setGrounded(false); setAppBlocking(false); setAccessibility(false);
    setProgress(emptyProgress); setRunning(false); setSeconds(0);
  }, [session, setProgress]);

  const loadNative = async (userId: string) => {
    // The app can still show its UI on platforms/builds that do not contain the Android module.
    if (!nativeFocus.available) return;
    try {
      // Read all three native states together to avoid displaying a mixed snapshot.
      const [vpn, blocking, saved] = await Promise.all([nativeFocus.status(), nativeFocus.appBlockingStatus(), nativeFocus.focusProgress(userId)]);
      setGrounded(vpn); setAccessibility(blocking.accessibilityEnabled); setAppBlocking(blocking.blockingEnabled);
      const protectedNow = vpn || blocking.blockingEnabled;
      if (saved.sessionActive && !protectedNow) {
        // Focus only earns points while at least one supported blocking method remains active.
        await nativeFocus.stopFocus(userId, false);
        setProgress(current => ({ ...current, sessionStartMillis: 0, sessionTargetMillis: 0, sessionActive: false }));
        setRunning(false); setSeconds(0); setNotice('Focus session ended because blocking was turned off. No points were awarded.');
        return;
      }
      setProgress(current => ({ ...current, sessionStartMillis: saved.sessionStartMillis, sessionTargetMillis: saved.sessionTargetMillis, sessionActive: saved.sessionActive }));
      setRunning(saved.sessionActive); setSeconds(saved.sessionActive ? Math.floor((Date.now() - saved.sessionStartMillis) / 1000) : 0);
    } catch { /* Native focus services are optional until an Android build is installed. */ }
  };

  useEffect(() => {
    // Derive elapsed time from the persisted start time rather than incrementing a counter.
    if (!running || !progress.sessionStartMillis) return;
    const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - progress.sessionStartMillis) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [running, progress.sessionStartMillis]);

  const finishFocus = async (complete: boolean, reason?: string) => {
    if (!session || !nativeFocus.available) return;
    try {
      const saved = await nativeFocus.stopFocus(session.user.id, complete);
      setRunning(false); setSeconds(0);
      setProgress(current => ({ ...current, sessionStartMillis: 0, sessionTargetMillis: 0, sessionActive: false }));
      if (saved.completed) {
        // The native module tracks time locally; the server records the completed session and score.
        const { error } = await supabase.rpc('record_focus_session', { p_duration_seconds: Math.round(saved.durationSeconds) });
        if (error) throw error;
        await loadSocial(session.user.id);
        setNotice(`Focus session complete — you earned ${Math.floor(saved.durationSeconds / 60)} grass points.`);
      } else if (reason) setNotice(reason);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not finish the focus session.'); }
    finally { completingFocus.current = false; }
  };

  const startFocus = async () => {
    if (!nativeFocus.available) { setNotice('Focus sessions need the TouchGrass Android native module. Install the React Native development build with `npx expo run:android`; Expo Go does not include this bridge.'); return; }
    if (!session) return;
    try {
      if (running) {
        // Ending early clears the local timer but deliberately awards no points.
        await finishFocus(false, 'Focus session ended early. No points were awarded.');
      } else {
        // Reject malformed/unsafe durations before asking the native module to start.
        const minutes = Number(focusMinutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Set a whole-number focus goal between 1 and 1,440 minutes.');
        if (!grounded && !appBlocking) throw new Error('Turn on Grounded Mode or app blocking before starting focus.');
        const saved = await nativeFocus.startFocus(session.user.id, minutes);
        completingFocus.current = false;
        setProgress(current => ({ ...current, sessionStartMillis: saved.sessionStartMillis, sessionTargetMillis: saved.sessionTargetMillis, sessionActive: saved.sessionActive }));
        setRunning(true); setSeconds(0);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not start the focus session.'); }
  };

  const toggleAppBlocking = async (enabled: boolean) => {
    if (!nativeFocus.available) { setNotice('App blocking needs the TouchGrass Android native module. Install the React Native development build with `npx expo run:android`; Expo Go does not include this bridge.'); return; }
    try {
      // Android requires the user to grant Accessibility access in system Settings first.
      if (enabled && !accessibility) { await nativeFocus.openAppBlockingSettings(); setNotice('Enable TouchGrass in Android Accessibility settings, then return here.'); return; }
      await nativeFocus.setAppBlockingEnabled(enabled); setAppBlocking(enabled);
      if (!enabled && running) await finishFocus(false, 'Focus session ended because app blocking was turned off. No points were awarded.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not update app blocking.'); }
  };

  const toggleGrounded = async (enabled: boolean) => {
    if (!nativeFocus.available) { setNotice('Grounded Mode needs the TouchGrass Android native module. Install the React Native development build with `npx expo run:android`; Expo Go does not include this bridge.'); return; }
    try {
      const active = enabled ? await nativeFocus.start() : await nativeFocus.stop();
      setGrounded(active);
      if (!enabled && running) await finishFocus(false, 'Focus session ended because Grounded Mode was turned off. No points were awarded.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not update Grounded Mode.'); }
  };

  useEffect(() => {
    // Finish automatically when the native target time has passed; the ref prevents duplicate RPCs.
    if (!running || !progress.sessionTargetMillis || Date.now() < progress.sessionTargetMillis || completingFocus.current) return;
    completingFocus.current = true;
    void finishFocus(true);
  }, [running, seconds, progress.sessionTargetMillis]);

  return { grounded, appBlocking, accessibility, running, seconds, focusMinutes, setFocusMinutes, progress, setProgress, loadNative, startFocus, finishFocus, toggleAppBlocking, toggleGrounded };
}
