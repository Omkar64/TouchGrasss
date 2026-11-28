import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, SafeAreaView, StatusBar, Text, View } from 'react-native';
import Ionicons from './node_modules/expo/node_modules/@expo/vector-icons/Ionicons';
import { supabase } from './src/supabase';
import { AuthScreen } from './src/screens/AuthScreen';
import { MainScreens } from './src/screens/MainScreens';
import { useAuth } from './src/hooks/useAuth';
import { useFeedback } from './src/hooks/useFeedback';
import { useFocus } from './src/hooks/useFocus';
import { useGatekeeper } from './src/hooks/useGatekeeper';
import { useSocial } from './src/hooks/useSocial';
import { emptyProgress, type AppTab, type Subpage } from './src/types';
import { styles } from './src/ui';

const forest = '#1A3C27';
const paper = '#F5F5ED';

// Expo's root component wires feature hooks to screens and owns top-level navigation/layout.
export default function App() {
  const feedback = useFeedback();
  const auth = useAuth(feedback.setNotice, feedback.runAction);
  const [tab, setTab] = useState<AppTab>('Today');
  const [subpage, setSubpage] = useState<Subpage>('home');
  const [progress, setProgress] = useState(emptyProgress);
  const social = useSocial(auth.session, feedback, setProgress);
  const focus = useFocus(auth.session, social.loadSocial, feedback, progress, setProgress);
  const gatekeeper = useGatekeeper(auth.session, focus.running, setSubpage, feedback);

  useEffect(() => {
    // Load account data after login, then keep it current with Supabase realtime and app resume events.
    const userId = auth.session?.user.id;
    if (!userId) return;

    void gatekeeper.refreshRequests();
    void social.loadSocial(userId);
    void focus.loadNative(userId);

    // Subscribe to tables that affect either the Gatekeeper inbox or the social/focus summaries.
    const changes = supabase.channel(`tg-requests-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unlock_requests' }, gatekeeper.refreshRequests)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unlock_grants', filter: `requester_id=eq.${userId}` }, gatekeeper.refreshRequests)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gatekeeper_connections' }, gatekeeper.refreshRequests)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_connections' }, () => social.loadSocial(userId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lawn_posts' }, () => social.loadSocial(userId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'focus_sessions' }, () => social.loadSocial(userId))
      .subscribe();
    const resume = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void gatekeeper.refreshRequests();
        void social.loadSocial(userId);
        void focus.loadNative(userId);
      }
    });
    return () => { void supabase.removeChannel(changes); resume.remove(); };
  }, [auth.session]);

  if (!auth.authReady) return <View style={styles.center}><ActivityIndicator color={forest} /></View>;
  if (!auth.session) return <><StatusBar barStyle="dark-content" /><AuthScreen createAccount={auth.createAccount} email={auth.email} password={auth.password} notice={feedback.notice} busy={feedback.busy} onEmailChange={auth.setEmail} onPasswordChange={auth.setPassword} onSubmit={auth.signIn} onToggleMode={() => { auth.setCreateAccount(!auth.createAccount); feedback.setNotice(''); }} /></>;

  const navItems = [
    { name: 'Today' as const, icon: 'sunny-outline' as const },
    { name: 'The Lawn' as const, icon: 'leaf-outline' as const },
    { name: 'Squad' as const, icon: 'people-outline' as const },
    { name: 'You' as const, icon: 'person-outline' as const },
  ];
  const nav = <View style={styles.nav}>{navItems.map(({ name, icon }) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === name }} key={name} onPress={() => { setTab(name); setSubpage('home'); }} style={[styles.navItem, tab === name && styles.navActive]}><Ionicons name={icon} size={22} color={tab === name ? forest : '#879286'} /><Text style={[styles.navLabel, tab === name && styles.navLabelActive]}>{name}</Text></Pressable>)}</View>;
  // Collect feature state/actions into one typed boundary for the screen router.
  const screenProps = {
    requests: gatekeeper.requests,
    session: auth.session,
    connections: gatekeeper.connections,
    subpage,
    target: gatekeeper.target,
    setTarget: gatekeeper.setTarget,
    notice: feedback.notice,
    busy: feedback.busy,
    isRecording: gatekeeper.isRecording,
    proofUri: gatekeeper.proofUri,
    proofUploading: gatekeeper.proofUploading,
    proofPlaying: gatekeeper.proofPlaying,
    recordVoiceProof: gatekeeper.recordVoiceProof,
    stopProofAudio: gatekeeper.stopProofAudio,
    playLocalProof: gatekeeper.playLocalProof,
    sendVoiceProof: gatekeeper.sendVoiceProof,
    inviteCode: gatekeeper.inviteCode,
    setInviteCode: gatekeeper.setInviteCode,
    generatedCode: gatekeeper.generatedCode,
    createInvite: gatekeeper.createInvite,
    redeemInvite: gatekeeper.redeemInvite,
    proofLoadingId: gatekeeper.proofLoadingId,
    playingRequestId: gatekeeper.playingRequestId,
    playProof: gatekeeper.playProof,
    review: gatekeeper.review,
    tab,
    grounded: focus.grounded,
    appBlocking: focus.appBlocking,
    seconds: focus.seconds,
    focusMinutes: focus.focusMinutes,
    setFocusMinutes: focus.setFocusMinutes,
    progress,
    startFocus: focus.startFocus,
    toggleAppBlocking: focus.toggleAppBlocking,
    accessibility: focus.accessibility,
    setSubpage,
    grants: gatekeeper.grants,
    cancelRequest: gatekeeper.cancelRequest,
    running: focus.running,
    postDraft: social.postDraft,
    setPostDraft: social.setPostDraft,
    postImage: social.postImage,
    setPostImage: social.setPostImage,
    choosePostImage: social.choosePostImage,
    publishPost: social.publishPost,
    posts: social.posts,
    cheeredPosts: social.cheeredPosts,
    setCheeredPosts: social.setCheeredPosts,
    friends: social.friends,
    createFriendInvite: social.createFriendInvite,
    generatedFriendCode: social.generatedFriendCode,
    friendCode: social.friendCode,
    setFriendCode: social.setFriendCode,
    redeemFriendInvite: social.redeemFriendInvite,
    toggleGrounded: focus.toggleGrounded,
    setNotice: feedback.setNotice,
  };

  return <SafeAreaView style={styles.root}>
    {/* The shared shell owns the brand, global notices, tabs, and back navigation. */}
    <StatusBar barStyle="dark-content" backgroundColor={paper} />
    <View style={styles.topbar}><Text style={styles.brand}>🌿 touchgrass</Text><Text numberOfLines={1} style={styles.streak}>🔥 {progress.currentStreak ? `${progress.currentStreak}d streak` : 'Start streak'}</Text></View>
    {feedback.notice ? <View style={styles.noticeBanner}><Text style={styles.notice}>{feedback.notice}</Text></View> : null}
    {feedback.toast ? <View pointerEvents="none" style={styles.toast}><Ionicons name="checkmark-circle" size={18} color="#FFFFFF" /><Text style={styles.toastText}>{feedback.toast}</Text></View> : null}
    <MainScreens {...screenProps} />
    {subpage === 'home' ? nav : <View style={styles.backbar}><Pressable onPress={() => setSubpage('home')}><Text style={styles.link}>‹  Back</Text></Pressable><Pressable onPress={() => supabase.auth.signOut()}><Text style={styles.link}>Sign out</Text></Pressable></View>}
  </SafeAreaView>;
}
