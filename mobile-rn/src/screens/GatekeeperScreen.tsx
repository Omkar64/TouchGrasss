import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Card, styles } from '../ui';
import type { ScreenProps } from './types';

// Pairing controls and pending requests for people acting as a Gatekeeper.
export function GatekeeperScreen({ primaryConnection, inviteCode, setInviteCode, generatedCode, createInvite, redeemInvite, busy, inbox = [], overseenCount = 0, proofLoadingId, playingRequestId, proofPlaying, stopProofAudio, playProof, review }: ScreenProps) {
  return <ScrollView contentContainerStyle={styles.page}>
    {/* Pairing is one-way: the creator asks for help and the redeemer becomes their reviewer. */}
    <Text style={styles.kicker}>GATEKEEPER</Text><Text style={styles.heading}>Your people.</Text><Text style={styles.muted}>One-way pairing: the person creating a code becomes the requester; the person entering it becomes their Gatekeeper.</Text>
    <Card><Text style={styles.cardTitle}>I need a Gatekeeper</Text><Text style={styles.muted}>{primaryConnection ? 'Your primary Gatekeeper is connected.' : 'Create a code and share it privately. It expires in 24 hours.'}</Text><Button label={primaryConnection ? 'Gatekeeper connected' : 'Create invite code'} onPress={createInvite} disabled={busy || !!primaryConnection} />{generatedCode ? <Text selectable style={styles.code}>{generatedCode}</Text> : null}</Card>
    <Card><Text style={styles.cardTitle}>I am someone’s Gatekeeper</Text><TextInput autoCapitalize="characters" maxLength={10} placeholder="Invite code" value={inviteCode} onChangeText={setInviteCode} style={styles.input} /><Button label="Accept invite" onPress={() => redeemInvite()} disabled={busy || !inviteCode} /></Card>
    {overseenCount > 0 ? <Card><Text style={styles.cardTitle}>You’re a Gatekeeper</Text><Text style={styles.muted}>You oversee {overseenCount} requester{overseenCount === 1 ? '' : 's'}. Their requests appear in this inbox.</Text></Card> : null}
    {/* Each inbox action either plays private proof or asks the server to approve/reject. */}
    <Text style={styles.sectionTitle}>Inbox</Text>{inbox.length ? inbox.map(item => <Card key={item.id}><Text style={styles.cardTitle}>{item.target_key} · {item.proof_type} proof</Text><Text style={styles.muted}>Request expires {new Date(item.expires_at).toLocaleString()}</Text><Button label={proofLoadingId === item.id ? 'Loading proof…' : playingRequestId === item.id ? (proofPlaying ? 'Stop proof' : 'Play proof') : '▶  Play voice proof'} onPress={() => playingRequestId === item.id ? stopProofAudio() : playProof(item)} disabled={!!proofLoadingId} /><View style={styles.inline}>{[5, 15, 30].map(minutes => <Pressable key={minutes} style={styles.smallButton} onPress={() => review(item.id, minutes)}><Text style={styles.smallButtonText}>{minutes} min</Text></Pressable>)}<Pressable style={styles.smallButton} onPress={() => review(item.id, null)}><Text style={styles.smallButtonText}>Reject</Text></Pressable></View></Card>) : <Text style={styles.muted}>No pending requests.</Text>}
  </ScrollView>;
}
