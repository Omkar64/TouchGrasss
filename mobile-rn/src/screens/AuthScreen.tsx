import React from 'react';
import { Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { Button, styles } from '../ui';

type AuthScreenProps = {
  // Current form values and mode.
  createAccount: boolean;
  email: string;
  password: string;
  notice: string;
  busy: boolean;
  // Callbacks keep this component presentational and independent of Supabase.
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onToggleMode: () => void;
};

// Pure form UI: authentication state and Supabase calls stay in the auth hook.
export function AuthScreen(props: AuthScreenProps) {
  const { createAccount, email, password, notice, busy, onEmailChange, onPasswordChange, onSubmit, onToggleMode } = props;
  return <SafeAreaView style={styles.auth}>
    <View style={styles.authBox}>
      <Text style={styles.logo}>🌿</Text>
      <Text style={styles.authTitle}>TouchGrass</Text>
      <Text style={styles.muted}>{createAccount ? 'Create an account to connect with your Gatekeeper.' : 'Sign in to connect with your Gatekeeper.'}</Text>
      <TextInput autoCapitalize="none" keyboardType="email-address" placeholder="Email" value={email} onChangeText={onEmailChange} style={styles.input} />
      <TextInput placeholder="Password" secureTextEntry value={password} onChangeText={onPasswordChange} style={styles.input} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Button label={busy ? 'Please wait…' : createAccount ? 'Create account' : 'Log in'} onPress={onSubmit} disabled={busy} />
      <Pressable onPress={onToggleMode}><Text style={styles.link}>{createAccount ? 'I already have an account' : 'Create an account'}</Text></Pressable>
    </View>
  </SafeAreaView>;
}
