import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { requestMagicLink } from '../src/api/client';
import { useSession } from '../src/auth/SessionProvider';

export default function LoginScreen() {
  const { session, booting } = useSession();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (booting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#38bdf8" />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/" />;
  }

  async function onSubmit() {
    setBusy(true);
    setStatus(null);
    try {
      await requestMagicLink(email.trim());
      setStatus(
        'Check your email. Open the link on this device so the app can redeem the session (Universal Link / vmp://).',
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not send sign-in link');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Sign in</Text>
      <Text style={styles.copy}>
        We email a magic link. On iOS/Android the installed app claims `/auth/verify` so you never
        need PWA notification login.
      </Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@example.com"
        placeholderTextColor="#64748b"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />
      <Pressable
        style={[styles.primaryBtn, busy && styles.disabled]}
        disabled={busy || !email.trim()}
        onPress={() => void onSubmit()}
      >
        {busy ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.primaryBtnText}>Email magic link</Text>
        )}
      </Pressable>
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <Pressable onPress={() => router.back()}>
        <Text style={styles.link}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { color: '#f8fafc', fontSize: 28, fontWeight: '700' },
  copy: { color: '#94a3b8', fontSize: 15, lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f8fafc',
    backgroundColor: '#0f172a',
  },
  primaryBtn: {
    backgroundColor: '#38bdf8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.6 },
  status: { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
  link: { color: '#38bdf8', fontSize: 14 },
});
