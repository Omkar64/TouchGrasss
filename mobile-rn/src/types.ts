import type { Session } from '@supabase/supabase-js';

// These types describe the shapes the screens and feature hooks share.
// Keeping them here prevents UI files from inventing slightly different models.
export type FocusStats = { totalFocusSeconds: number; grassPoints: number; sessions: number; currentStreak: number };
// Native focus timing is stored separately from the server-backed lifetime totals.
export type FocusProgress = FocusStats & { sessionStartMillis: number; sessionTargetMillis: number; sessionActive: boolean };
// These fields follow the Supabase table column names because query results use them directly.
export type UnlockRequest = { id: string; requester_id: string; gatekeeper_id: string; target_key: string; proof_type: string; proof_path: string; status: string; expires_at: string };
export type UnlockGrant = { target_key: string; usable_at: string; expires_at: string };
export type GatekeeperConnection = { id: string; requester_id: string; gatekeeper_id: string; created_at: string };
// Friend and feed data is normalized for easier rendering by the tabs.
export type Friend = { id: string; name: string; stats: FocusStats };
export type LawnPost = { id: string; user_id: string; body: string; image_path: string | null; image_url?: string; created_at: string; display_name: string };
export type PostImage = { uri: string; mimeType: string; extension: string };
export type AppSession = Session;
// Literal unions catch typos in navigation state at compile time.
export type AppTab = 'Today' | 'The Lawn' | 'Squad' | 'You';
export type Subpage = 'home' | 'gatekeeper' | 'request';

// Shared defaults are used when signing out and before the first focus summary loads.
export const emptyStats: FocusStats = { totalFocusSeconds: 0, grassPoints: 0, sessions: 0, currentStreak: 0 };
export const emptyProgress: FocusProgress = { ...emptyStats, sessionStartMillis: 0, sessionTargetMillis: 0, sessionActive: false };
