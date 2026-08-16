import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { completeDevicePairing } from '../src/api/client';
import { useSession } from '../src/auth/SessionProvider';

/** Phone/web side of Tier 2/3 pairing — approve a code shown on TV. */
export default function PairingScreen() {
  const { session, booting } = useSession();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (booting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#38bdf8" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  async function onApprove() {
    setBusy(true);
    setStatus(null);
    try {
      await completeDevicePairing(session!.accessToken, code);
      setStatus('Device approved. The TV can finish signing in.');
      setCode('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Approve a TV / device</Text>
      <Text style={styles.copy}>
        Enter the code shown on the TV (Tier 2/3). This uses Phase 0 pairing APIs so TV PoCs are not
        blocked.
      </Text>
      <TextInput
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD2345"
        placeholderTextColor="#64748b"
        style={styles.input}
        value={code}
        onChangeText={setCode}
      />
      <Pressable
        style={[styles.primaryBtn, busy && styles.disabled]}
        disabled={busy || code.trim().length < 6}
        onPress={() => void onApprove()}
      >
        {busy ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.primaryBtnText}>Approve</Text>
        )}
      </Pressable>
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { color: '#f8fafc', fontSize: 24, fontWeight: '700' },
  copy: { color: '#94a3b8', fontSize: 15, lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f8fafc',
    backgroundColor: '#0f172a',
    letterSpacing: 2,
    fontSize: 20,
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
});
