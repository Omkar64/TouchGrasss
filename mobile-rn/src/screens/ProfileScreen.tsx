import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, Metric, styles } from '../ui';
import { supabase } from '../supabase';
import type { ScreenProps } from './types';
import type { FocusProgress } from '../types';

// Read-only personal summary; actual totals are loaded by the social/focus hooks.
export function ProfileScreen({ progress, setSubpage }: ScreenProps) {
  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.kicker}>YOUR GROWTH</Text><Text style={styles.heading}>You’re putting{'\n'}in the work.</Text><Card><Text style={styles.cardTitle}>Your progress</Text><View style={styles.metricGrid}><MetricGrid progress={progress} /></View></Card><Button label="Open Gatekeeper" primary onPress={() => setSubpage('gatekeeper')} /><Button label="Sign out" destructive onPress={() => supabase.auth.signOut()} />
  </ScrollView>;
}

function MetricGrid({ progress }: { progress: FocusProgress }) {
  // Convert stored seconds/counts into short labels that fit the four metric tiles.
  return <>
    <Metric icon="time-outline" value={`${Math.floor(progress.totalFocusSeconds / 3600)}h ${Math.floor(progress.totalFocusSeconds % 3600 / 60)}m`} label="Focused" />
    <Metric icon="flame-outline" value={`${progress.currentStreak} day${progress.currentStreak === 1 ? '' : 's'}`} label="Streak" />
    <Metric icon="checkmark-circle-outline" value={String(progress.sessions)} label="Sessions" />
    <Metric icon="leaf-outline" value={String(progress.grassPoints)} label="Grass points" />
  </>;
}
