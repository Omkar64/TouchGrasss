import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './src/supabase';
import { nativeFocus } from './src/native';

const forest = '#183A2B', leaf = '#80B978', paper = '#F5F5ED';
const targets: Record<string, string> = { Instagram: 'instagram', TikTok: 'tiktok', X: 'x', Reddit: 'reddit', Snapchat: 'snapchat', Facebook: 'facebook', YouTube: 'youtube' };
type Request = { id: string; requester_id: string; gatekeeper_id: string; target_key: string; proof_type: string; proof_path: string; status: string; expires_at: string };
type Grant = { target_key: string; usable_at: string; expires_at: string };
type Connection = { id: string; requester_id: string; gatekeeper_id: string; created_at: string };
type FriendConnection = { id: string; user_low_id: string; user_high_id: string; created_at: string };
type Profile = { id: string; display_name: string };
type FocusStats = { totalFocusSeconds: number; grassPoints: number; sessions: number; currentStreak: number };
type LawnPost = { id: string; user_id: string; body: string; image_path: string | null; image_url?: string; created_at: string; display_name: string };
const emptyStats: FocusStats = { totalFocusSeconds: 0, grassPoints: 0, sessions: 0, currentStreak: 0 };

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [createAccount, setCreateAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('Today');
  const [subpage, setSubpage] = useState<'home' | 'gatekeeper' | 'request'>('home');
  const [notice, setNotice] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [requests, setRequests] = useState<Request[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const requestStatuses = useRef(new Map<string, string>());
  const requestsInitialized = useRef(false);
  const [target, setTarget] = useState('instagram');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [grounded, setGrounded] = useState(false);
  const [appBlocking, setAppBlocking] = useState(false);
  const [accessibility, setAccessibility] = useState(false);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [focusMinutes, setFocusMinutes] = useState('25');
  const [progress, setProgress] = useState({ totalFocusSeconds: 0, grassPoints: 0, sessions: 0, currentStreak: 0, sessionStartMillis: 0, sessionTargetMillis: 0, sessionActive: false });
  const [friends, setFriends] = useState<{ id: string; name: string; stats: FocusStats }[]>([]);
  const [posts, setPosts] = useState<LawnPost[]>([]);
  const [friendCode, setFriendCode] = useState('');
  const [generatedFriendCode, setGeneratedFriendCode] = useState('');
  const [postDraft, setPostDraft] = useState('');
  const [postImage, setPostImage] = useState<{ uri: string; mimeType: string; extension: string } | null>(null);
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofPlaying, setProofPlaying] = useState(false);
  const [playingRequestId, setPlayingRequestId] = useState<string | null>(null);
  const [proofLoadingId, setProofLoadingId] = useState<string | null>(null);
  const proofSound = useRef<Audio.Sound | null>(null);
  const completingFocus = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); });
    return () => listener.subscription.unsubscribe();
  }, []);

  const refreshRequests = async () => {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    const [requestResult, grantResult, connectionResult] = await Promise.all([
      supabase.from('unlock_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('unlock_grants').select('target_key,usable_at,expires_at').eq('requester_id', user.id).gt('expires_at', new Date().toISOString()),
      supabase.from('gatekeeper_connections').select('id,requester_id,gatekeeper_id,created_at'),
    ]);
    if (requestResult.error) setNotice(requestResult.error.message);
    else {
      const next = (requestResult.data ?? []) as Request[];
      if (requestsInitialized.current) {
        const previous = requestStatuses.current;
        const newInboxItem = next.some(r => r.gatekeeper_id === user.id && r.status === 'pending' && !previous.has(r.id));
        const newDecision = next.find(r => r.requester_id === user.id && previous.get(r.id) === 'pending' && r.status !== 'pending');
        if (newInboxItem) setNotice('A new Gatekeeper request arrived.');
        else if (newDecision) setNotice(newDecision.status === 'approved' ? 'Your Gatekeeper approved your pass.' : newDecision.status === 'rejected' ? 'Your Gatekeeper declined your request.' : `Your request is ${newDecision.status}.`);
      }
      requestStatuses.current = new Map(next.map(r => [r.id, r.status]));
      requestsInitialized.current = true;
      setRequests(next);
    }
    if (connectionResult.error) setNotice(connectionResult.error.message);
    else setConnections((connectionResult.data ?? []) as Connection[]);
    if (grantResult.error) setNotice(grantResult.error.message);
    else {
      const activeGrants = (grantResult.data ?? []) as Grant[];
      setGrants(activeGrants);
      if (nativeFocus.available) await nativeFocus.setUnlockGrants(activeGrants.map(g => ({ targetKey: g.target_key, usableAtMillis: Date.parse(g.usable_at), expiresAtMillis: Date.parse(g.expires_at) }))).catch(() => {});
    }
    await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'cleanup' } }).catch(() => {});
  };

  const loadSocial = async (userId: string) => {
    const { data: links, error: linksError } = await supabase.from('friend_connections').select('id,user_low_id,user_high_id,created_at');
    if (linksError) { setNotice(linksError.message); return; }
    const friendLinks = (links ?? []) as FriendConnection[];
    const friendIds = friendLinks.map(link => link.user_low_id === userId ? link.user_high_id : link.user_low_id);
    const ids = [userId, ...friendIds];
    const [profileResult, statsResult, postResult] = await Promise.all([
      supabase.from('profiles').select('id,display_name').in('id', ids),
      supabase.from('friend_focus_stats').select('user_id,total_focus_seconds,grass_points,sessions,current_streak').in('user_id', ids),
      supabase.from('lawn_posts').select('id,user_id,body,image_path,created_at').order('created_at', { ascending: false }).limit(100),
    ]);
    if (profileResult.error) { setNotice(profileResult.error.message); return; }
    if (statsResult.error) { setNotice(statsResult.error.message); return; }
    if (postResult.error) { setNotice(postResult.error.message); return; }
    const profileById = new Map(((profileResult.data ?? []) as Profile[]).map(profile => [profile.id, profile.display_name || 'TouchGrass member']));
    const statsById = new Map((statsResult.data ?? []).map((row: any) => [row.user_id, {
      totalFocusSeconds: Number(row.total_focus_seconds), grassPoints: Number(row.grass_points),
      sessions: Number(row.sessions), currentStreak: Number(row.current_streak),
    } as FocusStats]));
    setFriends(friendIds.map(id => ({ id, name: profileById.get(id) ?? 'TouchGrass member', stats: statsById.get(id) ?? emptyStats })));
    setProgress(current => ({ ...current, ...(statsById.get(userId) ?? emptyStats) }));
    const rawPosts = (postResult.data ?? []) as Omit<LawnPost, 'display_name' | 'image_url'>[];
    const hydratedPosts = await Promise.all(rawPosts.map(async post => {
      const { data } = post.image_path ? await supabase.storage.from('lawn-images').createSignedUrl(post.image_path, 3600) : { data: null };
      return { ...post, image_url: data?.signedUrl, display_name: profileById.get(post.user_id) ?? 'TouchGrass member' };
    }));
    setPosts(hydratedPosts);
  };

  useEffect(() => {
    if (!session) {
      setRequests([]); setConnections([]); setGrants([]); setFriends([]); setPosts([]);
      setProgress({ ...emptyStats, sessionStartMillis: 0, sessionTargetMillis: 0, sessionActive: false }); setRunning(false); setSeconds(0); setPostImage(null);
      setGeneratedCode(''); setGeneratedFriendCode(''); setFriendCode(''); setInviteCode(''); setProofUri(null); proofSound.current?.stopAsync().catch(() => {}); proofSound.current?.unloadAsync().catch(() => {}); proofSound.current = null; setProofPlaying(false); setPlayingRequestId(null);
      return;
    }
    refreshRequests(); loadSocial(session.user.id); loadNative(session.user.id);
    const changes = supabase.channel(`tg-requests-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unlock_requests' }, refreshRequests)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unlock_grants', filter: `requester_id=eq.${session.user.id}` }, refreshRequests)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gatekeeper_connections' }, refreshRequests)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_connections' }, () => loadSocial(session.user.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lawn_posts' }, () => loadSocial(session.user.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'focus_sessions' }, () => loadSocial(session.user.id))
      .subscribe();
    const resume = AppState.addEventListener('change', state => { if (state === 'active') { refreshRequests(); loadSocial(session.user.id); loadNative(session.user.id); } });
    return () => { supabase.removeChannel(changes); resume.remove(); };
  }, [session]);

  const loadNative = async (userId: string) => {
    if (!nativeFocus.available) return;
    try {
      const [vpn, blocking, saved] = await Promise.all([nativeFocus.status(), nativeFocus.appBlockingStatus(), nativeFocus.focusProgress(userId)]);
      setGrounded(vpn); setAccessibility(blocking.accessibilityEnabled); setAppBlocking(blocking.blockingEnabled);
      const protectedNow = vpn || blocking.blockingEnabled;
      if (saved.sessionActive && !protectedNow) {
        await nativeFocus.stopFocus(userId, false);
        setProgress(current => ({ ...current, sessionStartMillis: 0, sessionTargetMillis: 0, sessionActive: false }));
        setRunning(false); setSeconds(0); setNotice('Focus session ended because blocking was turned off. No points were awarded.');
        return;
      }
      setProgress(current => ({ ...current, sessionStartMillis: saved.sessionStartMillis, sessionTargetMillis: saved.sessionTargetMillis, sessionActive: saved.sessionActive }));
      setRunning(saved.sessionActive); setSeconds(saved.sessionActive ? Math.floor((Date.now() - saved.sessionStartMillis) / 1000) : 0);
    } catch { /* Android native services are optional until the RN bridge is integrated. */ }
  };

  useEffect(() => {
    if (!running || !progress.sessionStartMillis) return;
    const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - progress.sessionStartMillis) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [running, progress.sessionStartMillis]);

  const act = async (label: string, operation: () => Promise<any>) => {
    setBusy(true); setNotice('');
    try { const result = await operation(); setNotice(label); return result; }
    catch (e: any) { setNotice(e?.message ?? 'Something went wrong.'); return null; }
    finally { setBusy(false); }
  };

  const signIn = async () => {
    const address = email.trim();
    if (!address || !password) return setNotice('Enter your email and password.');
    if (createAccount) {
      if (password.length < 8) return setNotice('Use a password with at least 8 characters.');
      await act('Account created.', async () => {
        const { data, error } = await supabase.auth.signUp({ email: address, password, options: { data: { name: address.split('@')[0] } } });
        if (error) throw error;
        if (!data.session) throw new Error('Email confirmation is enabled in Supabase. Disable it in Authentication settings to sign in immediately.');
      });
    } else await act('Signed in.', async () => { const { error } = await supabase.auth.signInWithPassword({ email: address, password }); if (error) throw error; });
  };

  const finishFocus = async (complete: boolean, reason?: string) => {
    if (!session || !nativeFocus.available) return;
    try {
      const saved = await nativeFocus.stopFocus(session.user.id, complete);
      setRunning(false); setSeconds(0);
      setProgress(current => ({ ...current, sessionStartMillis: 0, sessionTargetMillis: 0, sessionActive: false }));
      if (saved.completed) {
        const { error } = await supabase.rpc('record_focus_session', { p_duration_seconds: Math.round(saved.durationSeconds) });
        if (error) throw error;
        await loadSocial(session.user.id);
        setNotice(`Focus session complete — you earned ${Math.floor(saved.durationSeconds / 60)} grass points.`);
      } else if (reason) setNotice(reason);
    } catch (e: any) { setNotice(e?.message ?? 'Could not finish the focus session.'); }
    finally { completingFocus.current = false; }
  };

  const startFocus = async () => {
    if (!nativeFocus.available) return setNotice('Focus scoring needs the Android service bridge. Your current Flutter build continues to provide blocking.');
    try {
      if (running) {
        await finishFocus(false, 'Focus session ended early. No points were awarded.');
      } else {
        const minutes = Number(focusMinutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Set a whole-number focus goal between 1 and 1,440 minutes.');
        if (!grounded && !appBlocking) throw new Error('Turn on Grounded Mode or app blocking before starting focus.');
        const saved = await nativeFocus.startFocus(session.user.id, minutes);
        completingFocus.current = false;
        setProgress(current => ({ ...current, sessionStartMillis: saved.sessionStartMillis, sessionTargetMillis: saved.sessionTargetMillis, sessionActive: saved.sessionActive }));
        setRunning(true); setSeconds(0);
      }
    } catch (e: any) { setNotice(e.message); }
  };

  const createFriendInvite = async () => {
    try {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const random = await Crypto.getRandomBytesAsync(10);
      const code = Array.from(random, byte => alphabet[byte % alphabet.length]).join('');
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, code);
      const { error } = await supabase.rpc('create_friend_invite', { p_code_hash: hash });
      if (error) throw error;
      setGeneratedFriendCode(code); setNotice('Friend code created. Share it privately; it expires in 24 hours.');
    } catch (e: any) { setNotice(e?.message ?? 'Could not create a friend code.'); }
  };

  const redeemFriendInvite = async () => {
    try {
      const code = friendCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 10) throw new Error('Enter the 10-character friend code.');
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, code);
      const { error } = await supabase.rpc('redeem_friend_invite', { p_code_hash: hash });
      if (error) throw error;
      setFriendCode(''); setGeneratedFriendCode(''); setNotice('Friend added. You can now see each other’s posts and points.');
      await loadSocial(session.user.id);
    } catch (e: any) { setNotice(e?.message ?? 'Could not accept that friend code.'); }
  };

  const choosePostImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Allow photo-library access in Android settings to add an image.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 0.8 });
      if (result.canceled) return;
      const asset = result.assets[0];
      const mimeType = asset.mimeType === 'image/png' || asset.mimeType === 'image/webp' ? asset.mimeType : 'image/jpeg';
      const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const info = await FileSystem.getInfoAsync(asset.uri);
      if (!info.exists || !info.size || info.size > 5 * 1024 * 1024) throw new Error('Choose an image no larger than 5 MB.');
      setPostImage({ uri: asset.uri, mimeType, extension });
    } catch (e: any) { setNotice(e?.message ?? 'Could not select that image.'); }
  };

  const publishPost = async () => {
    const body = postDraft.trim();
    if (!body && !postImage) return;
    if (body.length > 500) return setNotice('Posts can be up to 500 characters.');
    let imagePath: string | null = null;
    try {
      setBusy(true);
      if (postImage) {
        imagePath = `${session.user.id}/${Crypto.randomUUID()}.${postImage.extension}`;
        const base64 = await FileSystem.readAsStringAsync(postImage.uri, { encoding: FileSystem.EncodingType.Base64 });
        const { error: uploadError } = await supabase.storage.from('lawn-images').upload(imagePath, base64ToBytes(base64), { contentType: postImage.mimeType, upsert: false });
        if (uploadError) throw uploadError;
      }
      const { error } = await supabase.from('lawn_posts').insert({ user_id: session.user.id, body, image_path: imagePath });
      if (error) throw error;
      setPostDraft(''); setPostImage(null); setNotice('Your moment is on The Lawn.'); await loadSocial(session.user.id);
    } catch (e: any) {
      if (imagePath) await supabase.storage.from('lawn-images').remove([imagePath]).catch(() => {});
      setNotice(e?.message ?? 'Could not publish your post.');
    } finally { setBusy(false); }
  };

  const toggleAppBlocking = async (enabled: boolean) => {
    if (!nativeFocus.available) return setNotice('Android app blocking is available in your installed Flutter app while the React Native bridge is being connected.');
    try {
      if (enabled && !accessibility) { await nativeFocus.openAppBlockingSettings(); setNotice('Enable TouchGrass in Android Accessibility settings, then return here.'); return; }
      await nativeFocus.setAppBlockingEnabled(enabled); setAppBlocking(enabled);
      if (!enabled && running) await finishFocus(false, 'Focus session ended because app blocking was turned off. No points were awarded.');
    } catch (e: any) { setNotice(e.message); }
  };

  const toggleGrounded = async (enabled: boolean) => {
    if (!nativeFocus.available) return setNotice('Grounded Mode requires the Android development build.');
    try {
      const active = enabled ? await nativeFocus.start() : await nativeFocus.stop();
      setGrounded(active);
      if (!enabled && running) await finishFocus(false, 'Focus session ended because Grounded Mode was turned off. No points were awarded.');
    } catch (e: any) { setNotice(e?.message ?? 'Could not update Grounded Mode.'); }
  };

  const createInvite = async () => {
    const result = await act('', async () => {
      const { data, error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'create-invite' } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGeneratedCode(data.code); return data;
    });
    if (result) setNotice('Invite created. Share this code privately; it expires in 24 hours.');
  };

  const redeemInvite = () => act('Gatekeeper pairing accepted.', async () => {
    const { data, error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'redeem-invite', code: inviteCode.trim().toUpperCase() } });
    if (error) throw error; if (data?.error) throw new Error(data.error); await refreshRequests();
  });

  const review = async (requestId: string, minutes: number | null) => {
    await act('Decision sent.', async () => {
      const { data, error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'review-unlock-request', requestId, minutes } });
      if (error) throw error; if (data?.error) throw new Error(data.error); await refreshRequests();
    });
  };

  const stopProofAudio = async () => {
    const sound = proofSound.current;
    proofSound.current = null;
    setProofPlaying(false); setPlayingRequestId(null);
    if (sound) { await sound.stopAsync().catch(() => {}); await sound.unloadAsync().catch(() => {}); }
  };

  const playLocalProof = async () => {
    if (!proofUri) return;
    try {
      await stopProofAudio();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false });
      const { sound } = await Audio.Sound.createAsync({ uri: proofUri }, { shouldPlay: true }, status => {
        if (status.isLoaded) { setProofPlaying(status.isPlaying); if (status.didJustFinish) stopProofAudio(); }
      });
      proofSound.current = sound;
    } catch (e: any) { setNotice(e?.message ?? 'Could not play the recording preview.'); }
  };

  const recordVoiceProof = async () => {
    if (!running) return setNotice('Start an active focus session before asking for a pass.');
    if (isRecording || proofUploading) return;
    try {
      await stopProofAudio(); setProofUri(null);
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone access is off. Allow it in Android app settings, then try again.');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false });
      const { recording: started } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(started); setIsRecording(true); setNotice('Recording your five-second proof…');
      await new Promise(resolve => setTimeout(resolve, 5000));
      await started.stopAndUnloadAsync();
      const uri = started.getURI(); setRecording(null); setIsRecording(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false });
      if (!uri) throw new Error('Recording did not finish. Please try again.');
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || !info.size || info.size < 512) throw new Error('The recording is empty. Check microphone permission and try again.');
      setProofUri(uri); setNotice(`Recording ready (${Math.ceil(info.size / 1024)} KB). Play it back, then send it to your Gatekeeper.`);
    } catch (e: any) { setNotice(e?.message ?? 'Could not record voice proof.'); }
    finally { setIsRecording(false); setRecording(null); await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false }).catch(() => {}); }
  };

  const sendVoiceProof = async () => {
    if (!running) return setNotice('The focus session is no longer active, so this pass request cannot be sent.');
    if (!proofUri || proofUploading) return;
    let uploadedProofPath: string | null = null;
    try {
      setProofUploading(true); setNotice('Uploading voice proof…');
      const id = Crypto.randomUUID();
      const storagePath = `${session.user.id}/${id}.m4a`;
      const base64 = await FileSystem.readAsStringAsync(proofUri, { encoding: FileSystem.EncodingType.Base64 });
      const binary = base64ToBytes(base64);
      if (binary.byteLength < 512) throw new Error('The recording file is empty or unreadable. Record it again.');
      const { error: uploadError } = await supabase.storage.from('unlock-proofs').upload(storagePath, binary, { contentType: 'audio/mp4', upsert: false });
      if (uploadError) throw new Error(`Voice upload failed: ${uploadError.message}`);
      uploadedProofPath = storagePath;
      const { data, error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'create-unlock-request', requestId: id, targetKey: target, proofType: 'voice', proofPath: storagePath } });
      if (error) throw new Error(`Request could not be sent: ${error.message}`);
      if (data?.error) throw new Error(data.error);
      uploadedProofPath = null; await stopProofAudio(); await FileSystem.deleteAsync(proofUri, { idempotent: true }).catch(() => {}); setProofUri(null); setSubpage('home'); setNotice('Voice proof sent. Your Gatekeeper can play it from their inbox.'); await refreshRequests();
    } catch (e: any) {
      if (uploadedProofPath) await supabase.storage.from('unlock-proofs').remove([uploadedProofPath]).catch(() => {});
      setNotice(e?.message ?? 'Could not send your request. Your recording is still available to preview or retry.');
    } finally { setProofUploading(false); }
  };

  const playProof = async (item: Request) => {
    if (proofLoadingId) return;
    try {
      if (playingRequestId === item.id && proofSound.current) { await stopProofAudio(); return; }
      await stopProofAudio(); setProofLoadingId(item.id);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false });
      const { data, error } = await supabase.storage.from('unlock-proofs').createSignedUrl(item.proof_path, 60);
      if (error) throw error;
      const { sound } = await Audio.Sound.createAsync({ uri: data.signedUrl }, { shouldPlay: true }, status => {
        if (status.isLoaded) { setProofPlaying(status.isPlaying); if (status.didJustFinish) stopProofAudio(); }
      });
      proofSound.current = sound; setPlayingRequestId(item.id);
    } catch (e: any) { Alert.alert('Could not play voice proof', e?.message ?? 'Check your connection and try again.'); }
    finally { setProofLoadingId(null); }
  };

  const cancelRequest = (id: string) => act('Request cancelled.', async () => {
    const { error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'cancel-unlock-request', requestId: id } });
    if (error) throw error; await refreshRequests();
  });

  useEffect(() => {
    if (!running || !progress.sessionTargetMillis || Date.now() < progress.sessionTargetMillis || completingFocus.current) return;
    completingFocus.current = true;
    finishFocus(true);
  }, [running, seconds, progress.sessionTargetMillis]);

  if (!authReady) return <View style={styles.center}><ActivityIndicator color={forest} /></View>;
  if (!session) return <SafeAreaView style={styles.auth}><StatusBar barStyle="dark-content" />
    <View style={styles.authBox}><Text style={styles.logo}>🌿</Text><Text style={styles.authTitle}>TouchGrass</Text><Text style={styles.muted}>{createAccount ? 'Create an account to connect with your Gatekeeper.' : 'Sign in to connect with your Gatekeeper.'}</Text>
      <TextInput autoCapitalize="none" keyboardType="email-address" placeholder="Email" value={email} onChangeText={setEmail} style={styles.input} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Button label={busy ? 'Please wait…' : createAccount ? 'Create account' : 'Log in'} onPress={signIn} disabled={busy} />
      <Pressable onPress={() => { setCreateAccount(!createAccount); setNotice(''); }}><Text style={styles.link}>{createAccount ? 'I already have an account' : 'Create an account'}</Text></Pressable>
    </View>
  </SafeAreaView>;

  const header = <View style={styles.topbar}><Text style={styles.brand}>🌿 touchgrass</Text><Text style={styles.streak}>🔥 {progress.currentStreak || 'Start your streak'}</Text></View>;
  const nav = <View style={styles.nav}>{['Today', 'The Lawn', 'Squad', 'You'].map(name => <Pressable key={name} onPress={() => { setTab(name); setSubpage('home'); }} style={[styles.navItem, tab === name && styles.navActive]}><Text style={[styles.navLabel, tab === name && styles.navLabelActive]}>{name === 'Today' ? '◫' : name === 'The Lawn' ? '♣' : name === 'Squad' ? '♧' : '●'}{'\n'}{name}</Text></Pressable>)}</View>;

  const requestList = requests.filter(r => r.requester_id === session.user.id || r.gatekeeper_id === session.user.id);
  const primaryConnection = connections.find(c => c.requester_id === session.user.id);
  const overseenCount = connections.filter(c => c.gatekeeper_id === session.user.id).length;
  const inbox = requestList.filter(r => r.gatekeeper_id === session.user.id && r.status === 'pending');
  const mine = requestList.filter(r => r.requester_id === session.user.id).slice(0, 3);
  const content = subpage === 'request' ? <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.kicker}>GATEKEEPER</Text><Text style={styles.heading}>Ask for a pass.</Text><Text style={styles.muted}>Choose one blocked app and record a live five-second voice note explaining why you need a short pass.</Text>
    <Text style={styles.label}>Blocked app</Text><View style={styles.targets}>{Object.entries(targets).map(([label, key]) => <Pressable onPress={() => setTarget(key)} key={key} style={[styles.target, target === key && styles.targetSelected]}><Text style={target === key ? styles.targetTextSelected : styles.targetText}>{label}</Text></Pressable>)}</View>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}<View style={styles.spacer} /><Button label={isRecording ? 'Recording five-second proof…' : proofUri ? 'Record again' : '🎙  Record five-second proof'} onPress={recordVoiceProof} disabled={busy || isRecording || proofUploading} />
    {proofUri ? <><Text style={styles.muted}>Preview your recording before sharing it.</Text><Button label={proofPlaying ? 'Stop preview' : '▶  Play recording'} secondary onPress={proofPlaying ? stopProofAudio : playLocalProof} /><Button label={proofUploading ? 'Uploading voice proof…' : 'Send to Gatekeeper'} onPress={sendVoiceProof} disabled={proofUploading || isRecording} /></> : null}
    <Text style={styles.smallMuted}>Proof is shared only with your assigned Gatekeeper and automatically deleted.</Text>
  </ScrollView> : subpage === 'gatekeeper' ? <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.kicker}>GATEKEEPER</Text><Text style={styles.heading}>Your people.</Text><Text style={styles.muted}>One-way pairing: the person creating a code becomes the requester; the person entering it becomes their Gatekeeper.</Text>
    <Card><Text style={styles.cardTitle}>I need a Gatekeeper</Text><Text style={styles.muted}>{primaryConnection ? 'Your primary Gatekeeper is connected.' : 'Create a code and share it privately. It expires in 24 hours.'}</Text><Button label={primaryConnection ? 'Gatekeeper connected' : 'Create invite code'} onPress={createInvite} disabled={busy || !!primaryConnection} />{generatedCode ? <Text selectable style={styles.code}>{generatedCode}</Text> : null}</Card>
    <Card><Text style={styles.cardTitle}>I am someone’s Gatekeeper</Text><TextInput autoCapitalize="characters" maxLength={10} placeholder="Invite code" value={inviteCode} onChangeText={setInviteCode} style={styles.input} /><Button label="Accept invite" onPress={() => redeemInvite()} disabled={busy || !inviteCode} /></Card>
    {overseenCount > 0 ? <Card><Text style={styles.cardTitle}>You’re a Gatekeeper</Text><Text style={styles.muted}>You oversee {overseenCount} requester{overseenCount === 1 ? '' : 's'}. Their requests appear in this inbox.</Text></Card> : null}
    <Text style={styles.sectionTitle}>Inbox</Text>{inbox.length ? inbox.map(item => <Card key={item.id}><Text style={styles.cardTitle}>{item.target_key} · {item.proof_type} proof</Text><Text style={styles.muted}>Request expires {new Date(item.expires_at).toLocaleString()}</Text><Button label={proofLoadingId === item.id ? 'Loading proof…' : playingRequestId === item.id ? (proofPlaying ? 'Stop proof' : 'Play proof') : '▶  Play voice proof'} onPress={() => playingRequestId === item.id ? stopProofAudio() : playProof(item)} disabled={!!proofLoadingId} /><View style={styles.inline}>{[5, 15, 30].map(m => <Pressable key={m} style={styles.smallButton} onPress={() => review(item.id, m)}><Text style={styles.smallButtonText}>{m} min</Text></Pressable>)}<Pressable style={styles.smallButton} onPress={() => review(item.id, null)}><Text style={styles.smallButtonText}>Reject</Text></Pressable></View></Card>) : <Text style={styles.muted}>No pending requests.</Text>}
  </ScrollView> : tab === 'Today' ? <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.kicker}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</Text><Text style={styles.heading}>Make today{ '\n'}your own.</Text>
    <View style={styles.focusCard}><View style={styles.inlineBetween}><Text style={styles.cardKicker}>YOUR FOCUS SESSION</Text><Text style={styles.status}>{(grounded || appBlocking) ? '● GROUNDED' : '● OFF'}</Text></View><Text style={styles.timer}>{clock(seconds)}</Text>{running ? <Text style={styles.cardMuted}>Goal ends at {new Date(progress.sessionTargetMillis).toLocaleTimeString()}. Complete it to earn points.</Text> : <><Text style={styles.cardMuted}>Set your goal before starting. You earn 1 grass point per completed minute.</Text><TextInput keyboardType="number-pad" value={focusMinutes} onChangeText={setFocusMinutes} maxLength={4} style={[styles.input, styles.focusGoal]} placeholder="Focus minutes" /></>}<Button label={running ? 'End early — no points' : 'Start focus session'} onPress={startFocus} /></View>
    <View style={styles.statRow}><Card style={styles.stat}><Text style={styles.statNumber}>{progress.grassPoints}</Text><Text style={styles.smallMuted}>GRASS POINTS</Text></Card><Card style={styles.stat}><Text style={styles.statNumber}>{progress.sessions}</Text><Text style={styles.smallMuted}>FOCUS SESSIONS</Text></Card></View>
    <Text style={styles.sectionTitle}>App blocking</Text><Card><View style={styles.inlineBetween}><View style={styles.flex}><Text style={styles.cardTitle}>Block distracting apps</Text><Text style={styles.muted}>Instagram, TikTok, Reddit, X, Snapchat, Facebook and YouTube</Text></View><Switch value={appBlocking} onValueChange={toggleAppBlocking} trackColor={{ true: leaf }} /></View><Pressable onPress={() => toggleAppBlocking(true)}><Text style={styles.link}>{accessibility ? 'Manage Android Accessibility' : 'Enable app blocking access'}</Text></Pressable></Card>
    <Card><View style={styles.inlineBetween}><View style={styles.flex}><Text style={styles.cardTitle}>Grounded Mode</Text><Text style={styles.muted}>Block distracting domains with the local VPN.</Text></View><Switch value={grounded} onValueChange={toggleGrounded} trackColor={{ true: leaf }} /></View></Card>
    <View style={styles.inlineBetween}><Text style={styles.sectionTitle}>Your people</Text><Pressable onPress={() => setSubpage('gatekeeper')}><Text style={styles.link}>Manage</Text></Pressable></View>
    <Card><Text style={styles.cardTitle}>{primaryConnection ? 'Gatekeeper connected' : 'Gatekeeper pairing'}</Text><Text style={styles.muted}>{primaryConnection ? 'Your primary Gatekeeper can review pass requests.' : 'Connect a trusted person to review pass requests.'}</Text><Button label={primaryConnection ? 'Manage Gatekeeper' : 'Pair a Gatekeeper'} onPress={() => setSubpage('gatekeeper')} /></Card>
    {grants.length > 0 && <><Text style={styles.sectionTitle}>Your approved passes</Text>{grants.map((g, i) => <Card key={`${g.target_key}-${i}`}><Text style={styles.cardTitle}>{g.target_key} pass</Text><Text style={styles.muted}>{Date.now() < Date.parse(g.usable_at) ? `Cooldown: available at ${new Date(g.usable_at).toLocaleTimeString()}` : `Available now · ends ${new Date(g.expires_at).toLocaleTimeString()}`}</Text></Card>)}</>}
    {mine.length > 0 && <><Text style={styles.sectionTitle}>Recent Gatekeeper requests</Text>{mine.map(item => <Card key={item.id}><Text style={styles.cardTitle}>{item.target_key} · {item.status.toUpperCase()}</Text><Text style={styles.muted}>{item.status === 'pending' ? 'Waiting for a decision; expires after 24 hours.' : item.status === 'approved' ? 'A 60-second cooldown applies, then your pass begins.' : `Request ${item.status}.`}</Text>{item.status === 'pending' && <Pressable onPress={() => cancelRequest(item.id)}><Text style={styles.link}>Cancel request</Text></Pressable>}</Card>)}</>}
    {!primaryConnection ? <Text style={styles.smallMuted}>Pair a Gatekeeper before you can request a pass.</Text> : null}
    <Button label={running ? 'Ask for a pass' : 'Start focus to ask for a pass'} onPress={() => { setNotice(''); setSubpage('request'); }} disabled={!primaryConnection || !running} />
  </ScrollView> : tab === 'The Lawn' ? <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.kicker}>THE LAWN</Text><Text style={styles.heading}>Touch grass{ '\n'}together.</Text><Text style={styles.muted}>Share a small real-world win with your friends.</Text>
    <Card><Text style={styles.cardTitle}>Share a moment</Text><TextInput multiline maxLength={500} placeholder="What did you do away from your screen?" value={postDraft} onChangeText={setPostDraft} style={[styles.input, styles.postInput]} /><Text style={styles.smallMuted}>{postDraft.length}/500</Text>{postImage ? <><Image source={{ uri: postImage.uri }} style={styles.postImage} /><Pressable onPress={() => setPostImage(null)}><Text style={styles.link}>Remove image</Text></Pressable></> : null}<Button label={postImage ? 'Change photo' : 'Add a photo'} secondary onPress={choosePostImage} disabled={busy} /><Button label={busy ? 'Posting…' : 'Post to friends'} onPress={publishPost} disabled={busy || (!postDraft.trim() && !postImage)} /></Card>
    <Text style={styles.sectionTitle}>Friends’ moments</Text>{posts.length ? posts.map(post => <Card key={post.id}><Text style={styles.cardTitle}>{post.display_name}</Text>{post.body ? <Text style={styles.headingSmall}>{post.body}</Text> : null}{post.image_url ? <Image source={{ uri: post.image_url }} style={styles.postImage} /> : null}<Text style={styles.muted}>{new Date(post.created_at).toLocaleString()}</Text></Card>) : <Card><Text style={styles.cardTitle}>Your Lawn is quiet for now</Text><Text style={styles.muted}>{friends.length ? 'Share your first moment or invite a friend to get the conversation growing.' : 'Add a friend in Squad to share posts with each other.'}</Text></Card>}
  </ScrollView> : tab === 'Squad' ? <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.kicker}>FRIENDS</Text><Text style={styles.heading}>Better, together.</Text><Text style={styles.muted}>Friends can see each other’s posts and focus points.</Text>
    <Card><Text style={styles.cardTitle}>Add a friend</Text><Text style={styles.muted}>Create a one-time code and share it privately. It expires after 24 hours.</Text><Button label="Create friend code" onPress={createFriendInvite} />{generatedFriendCode ? <Text selectable style={styles.code}>{generatedFriendCode}</Text> : null}<TextInput autoCapitalize="characters" maxLength={10} placeholder="Enter a friend code" value={friendCode} onChangeText={setFriendCode} style={styles.input} /><Button label="Accept friend code" onPress={redeemFriendInvite} disabled={friendCode.trim().length !== 10} /></Card>
    <Text style={styles.sectionTitle}>Focus points</Text>{[{ id: session.user.id, name: 'You', stats: progress }, ...friends].sort((a, b) => b.stats.grassPoints - a.stats.grassPoints).map((person, index) => <Card key={person.id}><Text style={styles.cardTitle}>{index + 1}. {person.name}</Text><Text style={styles.muted}>{person.stats.grassPoints} points · {person.stats.currentStreak} day streak · {person.stats.sessions} sessions</Text></Card>)}
    {friends.length === 0 ? <Text style={styles.smallMuted}>Friend totals will appear here after you accept a code.</Text> : null}
  </ScrollView> : <ScrollView contentContainerStyle={styles.page}><Text style={styles.kicker}>YOUR GROWTH</Text><Text style={styles.heading}>You’re putting{ '\n'}in the work.</Text><Card><Text style={styles.statNumber}>{Math.floor(progress.totalFocusSeconds / 3600)}h {Math.floor(progress.totalFocusSeconds % 3600 / 60)}m</Text><Text style={styles.muted}>Total time focused</Text><Text style={styles.sectionTitle}>🔥  {progress.currentStreak} day streak</Text><Text style={styles.muted}>{progress.sessions} focus sessions · {progress.grassPoints} grass points</Text></Card><Button label="Open Gatekeeper" onPress={() => setSubpage('gatekeeper')} /><Button label="Sign out" secondary onPress={() => supabase.auth.signOut()} /></ScrollView>;

  return <SafeAreaView style={styles.root}><StatusBar barStyle="dark-content" />{header}{notice ? <View style={{ backgroundColor: '#E3EDDF', paddingHorizontal: 15, borderRadius: 12, marginHorizontal: 16 }}><Text style={styles.notice}>{notice}</Text></View> : null}{content}{subpage === 'home' ? nav : <View style={styles.backbar}><Pressable onPress={() => setSubpage('home')}><Text style={styles.link}>‹  Back</Text></Pressable><Pressable onPress={() => supabase.auth.signOut()}><Text style={styles.link}>Sign out</Text></Pressable></View>}</SafeAreaView>;
}

function base64ToBytes(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/\s/g, '').replace(/=+$/, '');
  const output = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let buffer = 0, bits = 0, offset = 0;
  for (const char of clean) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('The recorded audio could not be decoded. Record it again.');
    buffer = (buffer << 6) | digit; bits += 6;
    if (bits >= 8) { bits -= 8; output[offset++] = (buffer >> bits) & 0xff; buffer &= (1 << bits) - 1; }
  }
  return output.slice(0, offset);
}
function clock(s: number) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function Button({ label, onPress, disabled, secondary }: { label: string; onPress: () => any; disabled?: boolean; secondary?: boolean }) { return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, secondary && styles.buttonSecondary, disabled && { opacity: .5 }]}><Text style={[styles.buttonLabel, secondary && styles.buttonLabelSecondary]}>{label}</Text></Pressable>; }
function Card({ children, style }: { children: React.ReactNode; style?: any }) { return <View style={[styles.card, style]}>{children}</View>; }

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: paper }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: paper }, auth: { flex: 1, backgroundColor: paper, justifyContent: 'center', padding: 28 }, authBox: { gap: 12 }, logo: { fontSize: 54, textAlign: 'center' }, authTitle: { fontSize: 31, fontWeight: '800', color: forest, textAlign: 'center' }, muted: { color: '#79877B', fontSize: 14, lineHeight: 21 }, input: { borderColor: '#D7DED2', borderWidth: 1, borderRadius: 13, padding: 13, backgroundColor: '#FFF', color: forest, marginTop: 9 }, postInput: { minHeight: 92, textAlignVertical: 'top' }, focusGoal: { color: forest, backgroundColor: '#FFF', marginBottom: 3 }, postImage: { width: '100%', height: 220, borderRadius: 13, marginTop: 12, backgroundColor: '#E7EEE2' }, notice: { color: forest, fontSize: 13, marginVertical: 10 }, link: { color: '#648F56', fontWeight: '700', paddingVertical: 9 }, topbar: { height: 54, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: forest, fontSize: 20, fontWeight: '800' }, streak: { color: forest, backgroundColor: '#E7EEE2', borderRadius: 22, paddingHorizontal: 11, paddingVertical: 7, fontSize: 12, fontWeight: '700' }, page: { padding: 20, paddingBottom: 32 }, kicker: { color: '#79877B', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }, heading: { color: forest, fontSize: 34, lineHeight: 37, letterSpacing: -1.1, fontWeight: '800', marginBottom: 14 }, headingSmall: { color: forest, fontSize: 19, fontWeight: '800', marginTop: 10 }, headingSmallWhite: { color: '#FFF', fontSize: 23, fontWeight: '800', marginTop: 9 }, focusCard: { backgroundColor: forest, borderRadius: 24, padding: 20, marginVertical: 16 }, inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }, inlineBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, flex: { flex: 1 }, cardKicker: { color: '#B9D1B4', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, status: { color: '#D9EDC9', fontSize: 10, fontWeight: '800', backgroundColor: '#2B503D', padding: 8, borderRadius: 15, overflow: 'hidden' }, timer: { color: '#FFF', fontSize: 49, fontWeight: '700', marginTop: 9 }, cardMuted: { color: '#C2D2C4', fontSize: 13, marginBottom: 8 }, button: { marginTop: 12, borderRadius: 13, backgroundColor: '#D9EDC9', paddingHorizontal: 16, paddingVertical: 13, alignItems: 'center' }, buttonLabel: { color: forest, fontWeight: '800', fontSize: 14 }, buttonSecondary: { backgroundColor: '#E7EEE2' }, buttonLabelSecondary: { color: forest }, statRow: { flexDirection: 'row', gap: 12 }, stat: { flex: 1 }, card: { backgroundColor: '#FFF', borderRadius: 18, padding: 16, marginVertical: 6, borderWidth: 1, borderColor: '#E9EEE2' }, cardTitle: { color: forest, fontSize: 16, fontWeight: '800', marginBottom: 5 }, statNumber: { color: forest, fontSize: 25, fontWeight: '800' }, smallMuted: { color: '#79877B', fontSize: 10, marginTop: 7, textAlign: 'center' }, sectionTitle: { color: forest, fontSize: 20, fontWeight: '800', marginTop: 17, marginBottom: 6 }, nav: { height: 66, backgroundColor: '#FFF', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', borderTopWidth: 1, borderColor: '#E9EEE2' }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 55, marginHorizontal: 4, borderRadius: 15 }, navActive: { backgroundColor: '#E3EDDF' }, navLabel: { textAlign: 'center', fontSize: 11, color: '#79877B', lineHeight: 17 }, navLabelActive: { color: forest, fontWeight: '800' }, backbar: { height: 50, borderTopWidth: 1, borderColor: '#E9EEE2', paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF' }, code: { color: forest, fontSize: 27, textAlign: 'center', fontWeight: '800', letterSpacing: 4, padding: 13 }, targets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, target: { backgroundColor: '#FFF', borderColor: '#D7DED2', borderWidth: 1, borderRadius: 19, paddingHorizontal: 13, paddingVertical: 9 }, targetSelected: { backgroundColor: forest, borderColor: forest }, targetText: { color: forest, fontWeight: '600' }, targetTextSelected: { color: '#FFF', fontWeight: '700' }, label: { color: forest, fontWeight: '800', marginTop: 20 }, spacer: { height: 40 }, smallButton: { padding: 9, backgroundColor: '#E7EEE2', borderRadius: 10 }, smallButtonText: { color: forest, fontWeight: '700', fontSize: 12 } });
