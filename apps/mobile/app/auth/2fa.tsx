import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { firstSearchParam, safeRedirectPath } from '../../src/auth/deepLink';
import { useSession } from '../../src/auth/SessionProvider';
import { completeTotpLogin } from '../../src/auth/session';
import { isTotpSessionExpired, TotpVerifyError } from '../../src/auth/totp';

/**
 * Second step after magic-link redeem when the account has TOTP enabled.
 * Pending token lives in SessionProvider (not URL) for the ~5 minute API TTL.
 */
export default function AuthTwoFactorScreen() {
  const { session, booting, pendingTwoFactorToken, clearPendingTwoFactor, setSession } =
    useSession();
  const params = useLocalSearchParams<{ redirect?: string | string[] }>();
  const redirectTo = safeRedirectPath(firstSearchParam(params.redirect) || '/');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    if (!booting && !session && !pendingTwoFactorToken) {
      setSessionExpired(true);
    }
  }, [booting, session, pendingTwoFactorToken]);

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

  async function onSubmit() {
    if (!pendingTwoFactorToken || code.replace(/\D/g, '').length !== 6 || busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const next = await completeTotpLogin(pendingTwoFactorToken, code);
      clearPendingTwoFactor();
      setSession(next);
    } catch (err) {
      if (isTotpSessionExpired(err)) {
        clearPendingTwoFactor();
        setSessionExpired(true);
        setLocalError(err instanceof Error ? err.message : 'Sign-in session expired.');
      } else {
        setLocalError(
          err instanceof TotpVerifyError || err instanceof Error
            ? err.message
            : 'Invalid code. Please try again.',
        );
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  }

  const digits = code.replace(/\D/g, '').slice(0, 6);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Two-factor authentication</Text>
      <Text style={styles.copy}>Enter the 6-digit code from your authenticator app.</Text>

      {sessionExpired || !pendingTwoFactorToken ? (
        <>
          <Text style={styles.error}>
            {localError || 'Your sign-in session has expired. Please request a new magic link.'}
          </Text>
          <Pressable
            style={styles.primaryBtn}
            onPress={() => {
              clearPendingTwoFactor();
              router.replace('/login');
            }}
          >
            <Text style={styles.primaryBtnText}>Back to sign in</Text>
          </Pressable>
        </>
      ) : (
        <>
          {localError ? <Text style={styles.error}>{localError}</Text> : null}
          <TextInput
            autoFocus
            autoComplete="one-time-code"
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            placeholderTextColor="#64748b"
            style={styles.input}
            value={digits}
            editable={!busy}
            onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
            onSubmitEditing={() => void onSubmit()}
          />
          <Pressable
            style={[styles.primaryBtn, (busy || digits.length !== 6) && styles.disabled]}
            disabled={busy || digits.length !== 6}
            onPress={() => void onSubmit()}
          >
            {busy ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.primaryBtnText}>Verify</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              clearPendingTwoFactor();
              router.replace('/login');
            }}
          >
            <Text style={styles.link}>Request a new link</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 14, justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { color: '#f8fafc', fontSize: 22, fontWeight: '700' },
  copy: { color: '#94a3b8', fontSize: 15, lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#f8fafc',
    backgroundColor: '#0f172a',
    fontSize: 28,
    letterSpacing: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  primaryBtn: {
    backgroundColor: '#38bdf8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.6 },
  error: { color: '#f87171', fontSize: 14, lineHeight: 20 },
  link: { color: '#38bdf8', fontSize: 14, textAlign: 'center' },
});
