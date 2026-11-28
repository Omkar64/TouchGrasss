import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { nativeFocus } from '../native';
import type { AppSession, GatekeeperConnection, UnlockGrant, UnlockRequest } from '../types';
import { useVoiceProof } from './useVoiceProof';

type Feedback = {
  setNotice: (notice: string) => void;
  runAction: <T,>(label: string, operation: () => Promise<T>) => Promise<T | null>;
};

// Owns Gatekeeper pairing, request/grant data, and the actions that change that data.
export function useGatekeeper(session: AppSession | null, running: boolean, setSubpage: (page: 'home' | 'gatekeeper' | 'request') => void, { setNotice, runAction }: Feedback) {
  const [inviteCode, setInviteCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [requests, setRequests] = useState<UnlockRequest[]>([]);
  const [connections, setConnections] = useState<GatekeeperConnection[]>([]);
  const [grants, setGrants] = useState<UnlockGrant[]>([]);
  const requestStatuses = useRef(new Map<string, string>());
  const requestsInitialized = useRef(false);
  const [target, setTarget] = useState('instagram');

  useEffect(() => {
    // Clear account-specific records and request-difference tracking after logout.
    if (session) return;
    setRequests([]); setConnections([]); setGrants([]); setGeneratedCode(''); setInviteCode('');
    requestStatuses.current.clear(); requestsInitialized.current = false;
  }, [session]);

  const refreshRequests = async () => {
    // The backend returns the current user's RLS-filtered requests, grants, and relationships.
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    const [requestResult, grantResult, connectionResult] = await Promise.all([
      supabase.from('unlock_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('unlock_grants').select('target_key,usable_at,expires_at').eq('requester_id', user.id).gt('expires_at', new Date().toISOString()),
      supabase.from('gatekeeper_connections').select('id,requester_id,gatekeeper_id,created_at'),
    ]);
    if (requestResult.error) setNotice(requestResult.error.message);
    else {
      const next = (requestResult.data ?? []) as UnlockRequest[];
      if (requestsInitialized.current) {
        // Compare snapshots to show a notice only for newly arrived requests or decisions.
        const previous = requestStatuses.current;
        const newInboxItem = next.some(request => request.gatekeeper_id === user.id && request.status === 'pending' && !previous.has(request.id));
        const newDecision = next.find(request => request.requester_id === user.id && previous.get(request.id) === 'pending' && request.status !== 'pending');
        if (newInboxItem) setNotice('A new Gatekeeper request arrived.');
        else if (newDecision) setNotice(newDecision.status === 'approved' ? 'Your Gatekeeper approved your pass.' : newDecision.status === 'rejected' ? 'Your Gatekeeper declined your request.' : `Your request is ${newDecision.status}.`);
      }
      requestStatuses.current = new Map(next.map(request => [request.id, request.status]));
      requestsInitialized.current = true;
      setRequests(next);
    }
    if (connectionResult.error) setNotice(connectionResult.error.message);
    else setConnections((connectionResult.data ?? []) as GatekeeperConnection[]);
    if (grantResult.error) setNotice(grantResult.error.message);
    else {
      const activeGrants = (grantResult.data ?? []) as UnlockGrant[];
      setGrants(activeGrants);
      // Copy approved pass windows into Android so native enforcement uses the same cooldowns.
      if (nativeFocus.available) await nativeFocus.setUnlockGrants(activeGrants.map(grant => ({ targetKey: grant.target_key, usableAtMillis: Date.parse(grant.usable_at), expiresAtMillis: Date.parse(grant.expires_at) }))).catch(() => {});
    }
    await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'cleanup' } }).catch(() => {});
  };

  const createInvite = async () => {
    // Invite creation/redeeming is server-authoritative, so no relationship is created locally.
    const result = await runAction('', async () => {
      const { data, error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'create-invite' } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGeneratedCode(data.code);
      return data;
    });
    if (result) setNotice('Invite created. Share this code privately; it expires in 24 hours.');
  };

  const redeemInvite = () => runAction('Gatekeeper pairing accepted.', async () => {
    const { data, error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'redeem-invite', code: inviteCode.trim().toUpperCase() } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await refreshRequests();
  });

  const review = (requestId: string, minutes: number | null) => runAction('Decision sent.', async () => {
    // A null duration represents a rejection; a number approves a timed pass.
    const { data, error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'review-unlock-request', requestId, minutes } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await refreshRequests();
  });

  const cancelRequest = (id: string) => runAction('Request cancelled.', async () => {
    const { error } = await supabase.functions.invoke('gatekeeper-ops', { body: { action: 'cancel-unlock-request', requestId: id } });
    if (error) throw error;
    await refreshRequests();
  });

  // Voice capture/upload/playback is isolated because it has its own audio and file lifecycle.
  const voiceProof = useVoiceProof(session, running, target, refreshRequests, setSubpage, { setNotice });
  return { inviteCode, setInviteCode, generatedCode, requests, connections, grants, target, setTarget, refreshRequests, createInvite, redeemInvite, review, cancelRequest, ...voiceProof };
}
