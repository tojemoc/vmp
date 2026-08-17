import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { completeDevicePairing, previewDevicePairing } from '../src/api/client';
import { useSession } from '../src/auth/SessionProvider';

/** Matches server normalizePairingCode (packages/api/src/nativeClients.ts). */
function normalizePairingCode(raw: string): string | null {
  const normalized = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (normalized.length < 6 || normalized.length > 12) return null;
  return normalized;
}

/** Phone side of Tier 2/3 pairing — preview device context, then approve. */
export default function PairingScreen() {
  const { session, booting } = useSession();
  const [code, setCode] = useState('');
  const [previewedCode, setPreviewedCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    deviceName: string | null;
    devicePlatform: string | null;
    status: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalizedInput = normalizePairingCode(code);
  const canPreview = Boolean(normalizedInput) && !busy;
  const canApprove =
    Boolean(preview) &&
    previewedCode !== null &&
    normalizedInput === previewedCode &&
    preview?.status === 'pending' &&
    !busy;

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

  function clearPreviewState() {
    setPreview(null);
    setPreviewedCode(null);
  }

  async function onPreview() {
    const normalized = normalizePairingCode(code);
    if (!normalized) {
      clearPreviewState();
      setStatus('Enter a valid pairing code (6–12 characters).');
      return;
    }

    setBusy(true);
    setStatus(null);
    const requestedCode = normalized;
    try {
      const data = await previewDevicePairing(session!.accessToken, requestedCode);
      if (normalizePairingCode(code) !== requestedCode) {
        return;
      }
      setPreviewedCode(requestedCode);
      setPreview({
        deviceName: data.deviceName ?? null,
        devicePlatform: data.devicePlatform ?? null,
        status: data.status,
      });
    } catch (err) {
      if (normalizePairingCode(code) === requestedCode) {
        clearPreviewState();
        setStatus(err instanceof Error ? err.message : 'Preview failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onApprove() {
    const normalized = normalizePairingCode(code);
    if (!normalized || normalized !== previewedCode) {
      setStatus('Preview the current code before approving.');
      return;
    }
    if (preview?.status !== 'pending') {
      setStatus('This pairing code is no longer pending approval.');
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      await completeDevicePairing(session!.accessToken, normalized);
      setStatus('Device approved. The TV can finish signing in.');
      setCode('');
      clearPreviewState();
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
        Enter the code shown on your TV, preview the device label, then approve to sign it in.
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
          clearPreviewState();
        }}
      />
      <Pressable
        style={[styles.secondaryBtn, (!canPreview || busy) && styles.disabled]}
        disabled={!canPreview}
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
          <Text style={styles.previewHint}>
            Label set by the device — not verified by the server.
          </Text>
        </View>
      ) : null}
      <Pressable
        style={[styles.primaryBtn, !canApprove && styles.disabled]}
        disabled={!canApprove}
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
  previewHint: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  disabled: { opacity: 0.6 },
  status: { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
});
