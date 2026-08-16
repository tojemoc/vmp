import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { completeDevicePairing, previewDevicePairing } from '../src/api/client';
import { useSession } from '../src/auth/SessionProvider';

/** Phone side of Tier 2/3 pairing — preview device context, then approve. */
export default function PairingScreen() {
  const { session, booting } = useSession();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{
    deviceName: string | null;
    devicePlatform: string | null;
    status: string;
  } | null>(null);
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

  async function onPreview() {
    setBusy(true);
    setStatus(null);
    try {
      const data = await previewDevicePairing(session!.accessToken, code);
      setPreview({
        deviceName: data.deviceName ?? null,
        devicePlatform: data.devicePlatform ?? null,
        status: data.status,
      });
    } catch (err) {
      setPreview(null);
      setStatus(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function onApprove() {
    setBusy(true);
    setStatus(null);
    try {
      await completeDevicePairing(session!.accessToken, code);
      setStatus('Device approved. The TV can finish signing in.');
      setCode('');
      setPreview(null);
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
        PoC placement: home header action. Production should move this under settings/profile.
        Preview the device label, then approve.
      </Text>
      <TextInput
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD2345"
        placeholderTextColor="#64748b"
        style={styles.input}
        value={code}
        onChangeText={(value) => {
          setCode(value);
          setPreview(null);
        }}
      />
      <Pressable
        style={[styles.secondaryBtn, busy && styles.disabled]}
        disabled={busy || code.trim().length < 6}
        onPress={() => void onPreview()}
      >
        <Text style={styles.secondaryBtnText}>Preview</Text>
      </Pressable>
      {preview ? (
        <View style={styles.previewBox}>
          <Text style={styles.previewLine}>Status: {preview.status}</Text>
          <Text style={styles.previewLine}>
            Device: {preview.deviceName || 'unnamed'} ({preview.devicePlatform || 'unknown'})
          </Text>
        </View>
      ) : null}
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
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#cbd5e1', fontWeight: '600' },
  previewBox: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 4,
  },
  previewLine: { color: '#e2e8f0', fontSize: 14 },
  disabled: { opacity: 0.6 },
  status: { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
});
