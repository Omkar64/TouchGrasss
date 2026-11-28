import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, styles } from '../ui';
import type { ScreenProps } from './types';

const targets: Record<string, string> = { Instagram: 'instagram', TikTok: 'tiktok', X: 'x', Reddit: 'reddit', Snapchat: 'snapchat', Facebook: 'facebook', YouTube: 'youtube' };

// Screen for selecting a blocked app and recording/sending a temporary voice proof.
export function RequestPassScreen({ target, setTarget, notice, isRecording, proofUri, proofUploading, proofPlaying, recordVoiceProof, stopProofAudio, playLocalProof, sendVoiceProof, busy }: ScreenProps) {
  return <ScrollView contentContainerStyle={styles.page}>
    {/* The display label maps to the stable key stored in Gatekeeper requests. */}
    <Text style={styles.kicker}>GATEKEEPER</Text><Text style={styles.heading}>Ask for a pass.</Text><Text style={styles.muted}>Choose one blocked app and record a live five-second voice note explaining why you need a short pass.</Text>
    <Text style={styles.label}>Blocked app</Text><View style={styles.targets}>{Object.entries(targets).map(([label, key]) => <Pressable onPress={() => setTarget(key)} key={key} style={[styles.target, target === key && styles.targetSelected]}><Text style={target === key ? styles.targetTextSelected : styles.targetText}>{label}</Text></Pressable>)}</View>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}<View style={styles.spacer} /><Button label={isRecording ? 'Recording five-second proof…' : proofUri ? 'Record again' : '🎙  Record five-second proof'} onPress={recordVoiceProof} disabled={busy || isRecording || proofUploading} />
    {proofUri ? <><Text style={styles.muted}>Preview your recording before sharing it.</Text><Button label={proofPlaying ? 'Stop preview' : '▶  Play recording'} secondary onPress={proofPlaying ? stopProofAudio : playLocalProof} /><Button label={proofUploading ? 'Uploading voice proof…' : 'Send to Gatekeeper'} onPress={sendVoiceProof} disabled={proofUploading || isRecording} /></> : null}
    <Text style={styles.smallMuted}>Proof is shared only with your assigned Gatekeeper and automatically deleted.</Text>
  </ScrollView>;
}
