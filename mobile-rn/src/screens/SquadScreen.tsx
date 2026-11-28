import React from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { Avatar, Button, Card, styles } from '../ui';
import type { ScreenProps } from './types';

// Handles friend-code entry and shows local/server focus totals as a ranked list.
export function SquadScreen(props: ScreenProps) {
  const { createFriendInvite, generatedFriendCode, friendCode, setFriendCode, redeemFriendInvite, session, progress, friends } = props;
  // Keep the signed-in user in the same ranking as friends, then order by earned points.
  const leaderboard = [{ id: session.user.id, name: 'You', stats: progress }, ...friends].sort((first, second) => second.stats.grassPoints - first.stats.grassPoints);
  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.kicker}>FRIENDS</Text><Text style={styles.heading}>Better, together.</Text><Text style={styles.muted}>Friends can see each other’s posts and focus points.</Text>
    <Card><Text style={styles.cardTitle}>Add a friend</Text><Text style={styles.muted}>Create a one-time code and share it privately. It expires after 24 hours.</Text><Button label="Create friend code" onPress={createFriendInvite} />{generatedFriendCode ? <Text selectable style={styles.code}>{generatedFriendCode}</Text> : null}<View style={styles.orDivider}><View style={styles.dividerLine} /><Text style={styles.orText}>OR</Text><View style={styles.dividerLine} /></View><TextInput autoCapitalize="characters" maxLength={10} placeholder="Enter friend code" value={friendCode} onChangeText={setFriendCode} style={styles.input} /><Button label="Accept friend code" onPress={redeemFriendInvite} disabled={friendCode.trim().length !== 10} /></Card>
    {/* Ranking uses grass points; streak and completed sessions are supporting details. */}
    <Text style={styles.sectionTitle}>Focus points</Text>{leaderboard.map((person, index) => <Card key={person.id} style={styles.leaderCard}><View style={styles.rankBadge}><Text style={styles.rankText}>#{index + 1}</Text></View><Avatar name={person.name} /><View style={styles.leaderInfo}><Text style={styles.cardTitle}>{person.name}</Text><Text style={styles.leaderStats}>{person.stats.grassPoints} pts  ·  {person.stats.currentStreak}d streak  ·  {person.stats.sessions} sessions</Text></View></Card>)}
    {friends.length === 0 ? <Text style={styles.smallMuted}>Friend totals will appear here after you accept a code.</Text> : null}
  </ScrollView>;
}
