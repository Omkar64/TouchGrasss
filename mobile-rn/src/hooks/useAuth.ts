import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import type { AppSession } from '../types';

// Owns sign-in state and keeps the Supabase session synchronized with auth events.
export function useAuth(setNotice: (notice: string) => void, runAction: <T,>(label: string, operation: () => Promise<T>) => Promise<T | null>) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [createAccount, setCreateAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    // Restore an existing login before showing the app, then listen for login/logout changes.
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    // Normalize email before passing it to Supabase and give quick feedback for invalid input.
    const address = email.trim();
    if (!address || !password) { setNotice('Enter your email and password.'); return; }
    if (createAccount) {
      // Supabase confirmation settings may leave a new account without an active session.
      if (password.length < 8) { setNotice('Use a password with at least 8 characters.'); return; }
      await runAction('Account created.', async () => {
        const { data, error } = await supabase.auth.signUp({ email: address, password, options: { data: { name: address.split('@')[0] } } });
        if (error) throw error;
        if (!data.session) throw new Error('Email confirmation is enabled in Supabase. Disable it in Authentication settings to sign in immediately.');
      });
      return;
    }
    await runAction('Signed in.', async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: address, password });
      if (error) throw error;
    });
  };

  return { session, authReady, createAccount, setCreateAccount, email, setEmail, password, setPassword, signIn };
}
