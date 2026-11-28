import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../supabase';
import { base64ToBytes } from '../utils';
import { emptyStats, type AppSession, type FocusProgress, type FocusStats, type Friend, type LawnPost, type PostImage } from '../types';

type Profile = { id: string; display_name: string };
type FriendConnection = { id: string; user_low_id: string; user_high_id: string; created_at: string };
type FriendFocusRow = { user_id: string; total_focus_seconds: number | string; grass_points: number | string; sessions: number | string; current_streak: number | string };
type Feedback = { setNotice: (notice: string) => void; setBusy: (busy: boolean) => void; showToast: (message: string) => void };

// Loads friend/feed data and handles invites, photo selection, and post publishing.
export function useSocial(session: AppSession | null, feedback: Feedback, setProgress: Dispatch<SetStateAction<FocusProgress>>) {
  const { setNotice, setBusy, showToast } = feedback;
  const [cheeredPosts, setCheeredPosts] = useState<Set<string>>(() => new Set());
  const [friends, setFriends] = useState<Friend[]>([]);
  const [posts, setPosts] = useState<LawnPost[]>([]);
  const [friendCode, setFriendCode] = useState('');
  const [generatedFriendCode, setGeneratedFriendCode] = useState('');
  const [postDraft, setPostDraft] = useState('');
  const [postImage, setPostImage] = useState<PostImage | null>(null);

  useEffect(() => {
    // Social content and draft media are private to the signed-in account.
    if (session) return;
    setFriends([]); setPosts([]); setPostImage(null); setPostDraft('');
    setFriendCode(''); setGeneratedFriendCode(''); setCheeredPosts(new Set());
  }, [session]);

  const loadSocial = async (userId: string) => {
    // Fetch links first so profile and focus-stat queries can be limited to this user's friends.
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
    const statsRows = (statsResult.data ?? []) as FriendFocusRow[];
    const statsById = new Map<string, FocusStats>(statsRows.map((row): [string, FocusStats] => [row.user_id, {
      totalFocusSeconds: Number(row.total_focus_seconds), grassPoints: Number(row.grass_points),
      sessions: Number(row.sessions), currentStreak: Number(row.current_streak),
    }]));
    setFriends(friendIds.map(id => ({ id, name: profileById.get(id) ?? 'TouchGrass member', stats: statsById.get(id) ?? emptyStats })));
    setProgress(current => ({ ...current, ...(statsById.get(userId) ?? emptyStats) }));
    // Post rows only store image paths; signed URLs and display names are added for the UI.
    const rawPosts = (postResult.data ?? []) as Omit<LawnPost, 'display_name' | 'image_url'>[];
    const hydratedPosts = await Promise.all(rawPosts.map(async post => {
      const { data } = post.image_path ? await supabase.storage.from('lawn-images').createSignedUrl(post.image_path, 3600) : { data: null };
      return { ...post, image_url: data?.signedUrl, display_name: profileById.get(post.user_id) ?? 'TouchGrass member' };
    }));
    setPosts(hydratedPosts);
  };

  const createFriendInvite = async () => {
    try {
      // Generate a shareable code on-device but store only its hash in Supabase.
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const random = await Crypto.getRandomBytesAsync(10);
      const code = Array.from(random, byte => alphabet[byte % alphabet.length]).join('');
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, code);
      const { error } = await supabase.rpc('create_friend_invite', { p_code_hash: hash });
      if (error) throw error;
      setGeneratedFriendCode(code); setNotice('Friend code created. Share it privately; it expires in 24 hours.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not create a friend code.'); }
  };

  const redeemFriendInvite = async () => {
    try {
      if (!session) throw new Error('Sign in before accepting a friend code.');
      const code = friendCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 10) throw new Error('Enter the 10-character friend code.');
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, code);
      const { error } = await supabase.rpc('redeem_friend_invite', { p_code_hash: hash });
      if (error) throw error;
      setFriendCode(''); setGeneratedFriendCode(''); setNotice('Friend added. You can now see each other’s posts and points.');
      await loadSocial(session.user.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not accept that friend code.'); }
  };

  const choosePostImage = async () => {
    try {
      // Ask permission explicitly and reject large files before reading/uploading them.
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
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not select that image.'); }
  };

  const publishPost = async () => {
    if (!session) return;
    const body = postDraft.trim();
    if (!body && !postImage) return;
    if (body.length > 500) { setNotice('Posts can be up to 500 characters.'); return; }
    let imagePath: string | null = null;
    try {
      setBusy(true);
      if (postImage) {
        // Upload the media first; the database row stores its path, never a local device URI.
        imagePath = `${session.user.id}/${Crypto.randomUUID()}.${postImage.extension}`;
        const base64 = await FileSystem.readAsStringAsync(postImage.uri, { encoding: FileSystem.EncodingType.Base64 });
        const { error: uploadError } = await supabase.storage.from('lawn-images').upload(imagePath, base64ToBytes(base64), { contentType: postImage.mimeType, upsert: false });
        if (uploadError) throw uploadError;
      }
      const { error } = await supabase.from('lawn_posts').insert({ user_id: session.user.id, body, image_path: imagePath });
      if (error) throw error;
      setPostDraft(''); setPostImage(null); showToast('Your moment is on The Lawn.'); await loadSocial(session.user.id);
    } catch (error) {
      // Avoid leaving an orphaned image if creating the corresponding post row fails.
      if (imagePath) await supabase.storage.from('lawn-images').remove([imagePath]).catch(() => {});
      setNotice(error instanceof Error ? error.message : 'Could not publish your post.');
    } finally { setBusy(false); }
  };

  return { cheeredPosts, setCheeredPosts, friends, posts, friendCode, setFriendCode, generatedFriendCode, postDraft, setPostDraft, postImage, setPostImage, loadSocial, createFriendInvite, redeemFriendInvite, choosePostImage, publishPost };
}
