import React from 'react';
import { Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Ionicons from '../node_modules/expo/node_modules/@expo/vector-icons/Ionicons';

const forest = '#1A3C27';
const paper = '#F5F5ED';

// Shared display helpers keep repeated formatting and small visual components consistent.
// Show a compact relative-looking timestamp while keeping the exact time for today's posts.
export function formatMomentTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (now.getTime() - date.getTime() < 60_000) return 'Just now';
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
// Format seconds as a fixed-width MM:SS value for the focus timer.
export function clock(s: number) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
// Buttons share one base style and add visual variants through optional flags.
export function Button({ label, onPress, disabled, secondary, primary, outline, destructive }: { label: string; onPress: () => any; disabled?: boolean; secondary?: boolean; primary?: boolean; outline?: boolean; destructive?: boolean }) { return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, secondary && styles.buttonSecondary, primary && styles.buttonPrimary, outline && styles.buttonOutline, destructive && styles.buttonDestructive, disabled && { opacity: .5 }]}><Text style={[styles.buttonLabel, secondary && styles.buttonLabelSecondary, primary && styles.buttonLabelPrimary, destructive && styles.buttonLabelDestructive]}>{label}</Text></Pressable>; }
// Card adds the common white surface while still allowing a caller to provide a layout style.
export function Card({ children, style }: { children: React.ReactNode; style?: any }) { return <View style={[styles.card, style]}>{children}</View>; }
// Avatar derives initials when no image/profile photo is needed.
export function Avatar({ name }: { name: string }) { const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join(''); return <View style={styles.avatar}><Text style={styles.avatarText}>{initials || '?'}</Text></View>; }
// Metric is one tile in the profile progress grid.
export function Metric({ icon, value, label }: { icon: 'time-outline' | 'flame-outline' | 'checkmark-circle-outline' | 'leaf-outline'; value: string; label: string }) { return <View style={styles.metric}><View style={styles.metricTop}><Ionicons name={icon} size={17} color="#648F56" /><Text style={styles.metricLabel}>{label}</Text></View><Text style={styles.metricValue}>{value}</Text></View>; }

// Shared visual tokens are grouped by role: screen, form, focus, navigation, and feed.
export const styles = StyleSheet.create({
  // Screen root, loading state, and sign-in screen.
  root: { flex: 1, backgroundColor: paper, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: paper },
  auth: { flex: 1, backgroundColor: paper, justifyContent: 'center', padding: 28 }, authBox: { gap: 12 }, logo: { fontSize: 54, textAlign: 'center' }, authTitle: { fontSize: 31, fontWeight: '800', color: forest, textAlign: 'center' },
  // Shared labels and text inputs used across forms and cards.
  muted: { color: '#79877B', fontSize: 14, lineHeight: 21 },
  input: { borderColor: '#D7DED2', borderWidth: 1, borderRadius: 13, padding: 13, backgroundColor: '#FFF', color: forest, marginTop: 9 }, postInput: { minHeight: 92, textAlignVertical: 'top' },
  // Duration picker and image preview sizing.
  durationBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderColor: '#D7DED2', borderWidth: 1, borderRadius: 13, marginTop: 9, paddingHorizontal: 13 },
  durationInput: { flex: 1, paddingVertical: 11, color: forest, fontSize: 18, fontWeight: '700' }, durationSuffix: { color: '#79877B', fontWeight: '700', paddingLeft: 8 },
  presets: { flexDirection: 'row', gap: 8, marginTop: 10 }, preset: { borderRadius: 18, paddingVertical: 7, paddingHorizontal: 14, backgroundColor: '#E7EEE2' }, presetSelected: { backgroundColor: '#D8E8D3' }, presetText: { color: forest, fontWeight: '700', fontSize: 12 }, presetTextSelected: { color: forest },
  postImage: { width: '100%', height: 220, borderRadius: 13, marginTop: 12, backgroundColor: '#E7EEE2' }, notice: { color: forest, fontSize: 13, marginVertical: 10 },
  // Global status banner and short confirmation toast.
  noticeBanner: { backgroundColor: '#E3EDDF', paddingHorizontal: 15, borderRadius: 12, marginHorizontal: 16 },
  toast: { position: 'absolute', zIndex: 5, top: 60, left: 20, right: 20, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: forest, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, elevation: 5 }, toastText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  link: { color: '#648F56', fontWeight: '700', paddingVertical: 9 },
  // Header and page-level heading styles.
  topbar: { minHeight: 58, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, brand: { color: forest, fontSize: 20, fontWeight: '800', letterSpacing: -.4 }, streak: { color: forest, backgroundColor: '#D8E8D3', borderRadius: 22, paddingHorizontal: 13, paddingVertical: 8, fontSize: 12, fontWeight: '800', overflow: 'hidden', maxWidth: 140 },
  page: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28 }, kicker: { color: '#79877B', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }, heading: { color: forest, fontSize: 34, lineHeight: 37, letterSpacing: -1.1, fontWeight: '800', marginBottom: 14 }, headingSmall: { color: forest, fontSize: 19, lineHeight: 25, fontWeight: '700', marginTop: 10 }, headingSmallWhite: { color: '#FFF', fontSize: 23, fontWeight: '800', marginTop: 9 },
  // Focus card and button variants.
  focusCard: { backgroundColor: forest, borderRadius: 24, padding: 20, marginVertical: 16 }, inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }, inlineBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, flex: { flex: 1, minWidth: 0 },
  cardKicker: { color: '#B9D1B4', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, status: { color: '#D9EDC9', fontSize: 10, fontWeight: '800', backgroundColor: '#2B503D', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 15, overflow: 'hidden' },
  timer: { color: '#FFF', fontSize: 52, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: 1, marginTop: 10, marginBottom: 2 }, cardMuted: { color: '#C2D2C4', fontSize: 13, lineHeight: 19, marginBottom: 8 },
  button: { marginTop: 12, borderRadius: 13, backgroundColor: '#D8E8D3', paddingHorizontal: 16, paddingVertical: 13, alignItems: 'center' }, buttonLabel: { color: forest, fontWeight: '800', fontSize: 14 }, buttonSecondary: { backgroundColor: '#E7EEE2' }, buttonLabelSecondary: { color: forest },
  buttonPrimary: { backgroundColor: forest }, buttonLabelPrimary: { color: '#FFF' }, buttonOutline: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CAD9C5' }, buttonDestructive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#D8C7C4' }, buttonLabelDestructive: { color: '#875B56', fontWeight: '600' }, buttonWithIcon: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  // Statistics, card surfaces, and section labels.
  statRow: { flexDirection: 'row', gap: 12 }, stat: { flex: 1 }, card: { backgroundColor: '#FFF', borderRadius: 18, padding: 16, marginVertical: 6, borderWidth: 1, borderColor: '#E9EEE2' }, cardTitle: { color: forest, fontSize: 16, fontWeight: '800', marginBottom: 5 }, statNumber: { color: forest, fontSize: 25, fontWeight: '800', fontVariant: ['tabular-nums'] }, smallMuted: { color: '#79877B', fontSize: 10, marginTop: 7, textAlign: 'center' }, sectionTitle: { color: forest, fontSize: 20, fontWeight: '800', marginTop: 17, marginBottom: 6 },
  appPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }, appPill: { backgroundColor: '#F0F4ED', borderRadius: 14, color: '#526A53', fontSize: 10, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  // Bottom tab bar and back bar for nested pages.
  nav: { minHeight: 70, paddingTop: 7, paddingBottom: Platform.OS === 'android' ? 12 : 2, backgroundColor: '#FFF', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', borderTopWidth: 1, borderColor: '#E9EEE2' }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 54, marginHorizontal: 4, borderRadius: 15, gap: 3 }, navActive: { backgroundColor: '#E3EDDF' }, navLabel: { textAlign: 'center', fontSize: 11, color: '#79877B' }, navLabelActive: { color: forest, fontWeight: '800' },
  // Feed, friend-code, leaderboard, and profile metric layouts.
  backbar: { height: 50, borderTopWidth: 1, borderColor: '#E9EEE2', paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF' }, code: { color: forest, fontSize: 27, textAlign: 'center', fontWeight: '800', letterSpacing: 4, padding: 13 }, targets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, target: { backgroundColor: '#FFF', borderColor: '#D7DED2', borderWidth: 1, borderRadius: 19, paddingHorizontal: 13, paddingVertical: 9 }, targetSelected: { backgroundColor: forest, borderColor: forest }, targetText: { color: forest, fontWeight: '600' }, targetTextSelected: { color: '#FFF', fontWeight: '700' }, label: { color: forest, fontWeight: '800', marginTop: 20 }, spacer: { height: 40 }, smallButton: { padding: 9, backgroundColor: '#E7EEE2', borderRadius: 10 }, smallButtonText: { color: forest, fontWeight: '700', fontSize: 12 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 }, avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#D8E8D3', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: forest, fontWeight: '800', fontSize: 15 }, feedTime: { color: '#879286', fontSize: 12, marginTop: -3 }, cheerButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, borderRadius: 18, backgroundColor: '#F0F4ED', paddingVertical: 7, paddingHorizontal: 11 }, cheerButtonActive: { backgroundColor: '#D8E8D3' }, cheerText: { color: forest, fontWeight: '700', fontSize: 12 },
  orDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 17 }, dividerLine: { flex: 1, height: 1, backgroundColor: '#E4E9E0' }, orText: { color: '#879286', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  leaderCard: { flexDirection: 'row', alignItems: 'center', gap: 11 }, rankBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EAF1E7', alignItems: 'center', justifyContent: 'center' }, rankText: { color: forest, fontSize: 12, fontWeight: '800' }, leaderInfo: { flex: 1, minWidth: 0 }, leaderStats: { color: '#79877B', fontSize: 12 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 7 }, metric: { width: '50%', paddingVertical: 13, paddingHorizontal: 8, borderTopWidth: 1, borderColor: '#EEF1EA' }, metricTop: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 5 }, metricLabel: { color: '#79877B', fontSize: 11, fontWeight: '600' }, metricValue: { color: forest, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
