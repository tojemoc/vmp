import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { requestMagicLink } from '../src/api/client';
import { firstSearchParam, safeRedirectPath } from '../src/auth/deepLink';
import { useSession } from '../src/auth/SessionProvider';

type Step = 'email' | 'code';

/**
 * Native sign-in: same magic-link email as web, with optional confirmation code.
 * `client=native` + `redirect` are stamped on the request so the email link and
 * OTP verify share provenance with browser/PWA flows.
 */
export default function LoginScreen() {
  const { session, booting, completeEmailCode } = useSession();
  const params = useLocalSearchParams<{ redirect?: string | string[] }>();
  const redirectTo = safeRedirectPath(firstSearchParam(params.redirect) || '/');

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
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

  if (session) {
    return <Redirect href={redirectTo as '/'} />;
  }

  async function onSendCode() {
    const normalized = email.trim().toLowerCase();
    if (!normalized || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await requestMagicLink(normalized, redirectTo, 'native');
      setEmail(normalized);
      setStep('code');
      setCode('');
      setStatus(
        'Check your email for a 6-digit code (and a sign-in link). Enter the code here to stay in the app.',
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not send sign-in email');
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyCode() {
    const digits = code.replace(/\D/g, '').slice(0, 6);
    if (digits.length < 6 || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const outcome = await completeEmailCode(email.trim().toLowerCase(), digits);
      if (outcome === 'two_factor_required') {
        const href =
          redirectTo === '/'
            ? ('/auth/2fa' as const)
            : (`/auth/2fa?redirect=${encodeURIComponent(redirectTo)}` as '/auth/2fa');
        router.replace(href);
        return;
      }
      if (outcome === 'failed') {
        setStatus('Invalid or expired code. Request a new one.');
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not verify code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Sign in</Text>
      <Text style={styles.copy}>
        We email a confirmation code and a magic link. Enter the code here, or open the link on this
        device. Both carry your return path and the native client stamp.
      </Text>

      {step === 'email' ? (
        <>
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
            onPress={() => void onSendCode()}
          >
            {busy ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.primaryBtnText}>Send confirmation code</Text>
            )}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.emailLabel}>{email}</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="one-time-code"
            keyboardType="number-pad"
            maxLength={6}
            placeholder="6-digit code"
            placeholderTextColor="#64748b"
            style={styles.input}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          />
          <Pressable
            style={[styles.primaryBtn, busy && styles.disabled]}
            disabled={busy || code.replace(/\D/g, '').length < 6}
            onPress={() => void onVerifyCode()}
          >
            {busy ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </Pressable>
          <View style={styles.row}>
            <Pressable disabled={busy} onPress={() => void onSendCode()}>
              <Text style={styles.link}>Resend code</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => {
                setStep('email');
                setCode('');
                setStatus(null);
              }}
            >
              <Text style={styles.link}>Use a different email</Text>
            </Pressable>
          </View>
        </>
      )}

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
  emailLabel: { color: '#cbd5e1', fontSize: 14 },
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
});
