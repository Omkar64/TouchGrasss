import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Audio } from 'expo-av';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../supabase';
import { base64ToBytes } from '../utils';
import type { AppSession, UnlockRequest } from '../types';

type Feedback = { setNotice: (notice: string) => void };

// Manages the temporary voice proof from microphone capture through private upload and playback.
export function useVoiceProof(session: AppSession | null, running: boolean, target: string, refreshRequests: () => Promise<void>, setSubpage: (page: 'home' | 'gatekeeper' | 'request') => void, { setNotice }: Feedback) {
  const [isRecording, setIsRecording] = useState(false);
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofPlaying, setProofPlaying] = useState(false);
  const [playingRequestId, setPlayingRequestId] = useState<string | null>(null);
  const [proofLoadingId, setProofLoadingId] = useState<string | null>(null);
  const proofSound = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    // Drop local proof UI state on logout; the sound cleanup below also releases native audio resources.
    if (session) return;
    setProofUri(null); setProofPlaying(false); setPlayingRequestId(null); setProofLoadingId(null); setIsRecording(false); setProofUploading(false);
    void stopProofAudio();
  }, [session]);

  useEffect(() => () => {
    // Stop playback and release the native player if this hook's owner unmounts.
    const sound = proofSound.current;
    proofSound.current = null;
    if (sound) { void sound.stopAsync().catch(() => {}); void sound.unloadAsync().catch(() => {}); }
  }, []);

  const stopProofAudio = async () => {
    // Clear the ref before awaiting native work so two rapid taps cannot reuse the same player.
    const sound = proofSound.current;
    proofSound.current = null;
    setProofPlaying(false); setPlayingRequestId(null);
    if (sound) { await sound.stopAsync().catch(() => {}); await sound.unloadAsync().catch(() => {}); }
  };

  const playLocalProof = async () => {
    // The requester can listen to their local file before uploading it.
    if (!proofUri) return;
    try {
      await stopProofAudio();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false });
      const { sound } = await Audio.Sound.createAsync({ uri: proofUri }, { shouldPlay: true }, status => {
        if (status.isLoaded) { setProofPlaying(status.isPlaying); if (status.didJustFinish) void stopProofAudio(); }
      });
      proofSound.current = sound;
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not play the recording preview.'); }
  };

  const recordVoiceProof = async () => {
    // Proof is only allowed during an active protected focus session.
    if (!running) { setNotice('Start an active focus session before asking for a pass.'); return; }
    if (isRecording || proofUploading) return;
    try {
      await stopProofAudio(); setProofUri(null);
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone access is off. Allow it in Android app settings, then try again.');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setIsRecording(true); setNotice('Recording your five-second proof…');
      await new Promise(resolve => setTimeout(resolve, 5000));
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI(); setIsRecording(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false });
      if (!uri) throw new Error('Recording did not finish. Please try again.');
      const info = await FileSystem.getInfoAsync(uri);
      // Tiny/empty files usually indicate a denied microphone permission or failed recording.
      if (!info.exists || !info.size || info.size < 512) throw new Error('The recording is empty. Check microphone permission and try again.');
      setProofUri(uri); setNotice(`Recording ready (${Math.ceil(info.size / 1024)} KB). Play it back, then send it to your Gatekeeper.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not record voice proof.'); }
    finally { setIsRecording(false); await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false }).catch(() => {}); }
  };

  const sendVoiceProof = async () => {
    if (!session) return;
    if (!running) { setNotice('The focus session is no longer active, so this pass request cannot be sent.'); return; }
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
      // The Edge Function validates the request and links the uploaded file to the Gatekeeper inbox.
      const { data, error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'create-unlock-request', requestId: id, targetKey: target, proofType: 'voice', proofPath: storagePath } });
      if (error) throw new Error(`Request could not be sent: ${error.message}`);
      if (data?.error) throw new Error(data.error);
      uploadedProofPath = null; await stopProofAudio(); await FileSystem.deleteAsync(proofUri, { idempotent: true }).catch(() => {}); setProofUri(null); setSubpage('home'); setNotice('Voice proof sent. Your Gatekeeper can play it from their inbox.'); await refreshRequests();
    } catch (error) {
      // Remove an upload if the request was rejected, but keep the local recording for retry.
      if (uploadedProofPath) await supabase.storage.from('unlock-proofs').remove([uploadedProofPath]).catch(() => {});
      setNotice(error instanceof Error ? error.message : 'Could not send your request. Your recording is still available to preview or retry.');
    } finally { setProofUploading(false); }
  };

  const playProof = async (item: UnlockRequest) => {
    // Gatekeepers receive a short-lived signed URL for the private uploaded recording.
    if (proofLoadingId) return;
    try {
      if (playingRequestId === item.id && proofSound.current) { await stopProofAudio(); return; }
      await stopProofAudio(); setProofLoadingId(item.id);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false });
      // Use a short-lived URL so private voice proofs are not made public in storage.
      const { data, error } = await supabase.storage.from('unlock-proofs').createSignedUrl(item.proof_path, 60);
      if (error) throw error;
      const { sound } = await Audio.Sound.createAsync({ uri: data.signedUrl }, { shouldPlay: true }, status => {
        if (status.isLoaded) { setProofPlaying(status.isPlaying); if (status.didJustFinish) void stopProofAudio(); }
      });
      proofSound.current = sound; setPlayingRequestId(item.id);
    } catch (error) { Alert.alert('Could not play voice proof', error instanceof Error ? error.message : 'Check your connection and try again.'); }
    finally { setProofLoadingId(null); }
  };

  return { isRecording, proofUri, proofUploading, proofPlaying, playingRequestId, proofLoadingId, stopProofAudio, playLocalProof, recordVoiceProof, sendVoiceProof, playProof };
}
