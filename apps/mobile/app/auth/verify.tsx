import * as Linking from 'expo-linking';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { firstSearchParam, safeRedirectPath, tokenFromAuthUrl } from '../../src/auth/deepLink';
import { useSession } from '../../src/auth/SessionProvider';
import { customSchemeDeepLinksAllowed } from '../../src/features';

/**
 * Deep-link landing screen for magic links.
 * Matches `/auth/verify` from HTTPS App Links and `vmp://auth/verify` (PoC).
 * Without this route Expo Router shows "Unmatched Route" even when SessionProvider
 * redeems the token in the background.
 */
export default function AuthVerifyScreen() {
  const { session, booting, error, handleIncomingUrl, completeMagicLink } = useSession();
  const params = useLocalSearchParams<{
    token?: string | string[];
    redirect?: string | string[];
  }>();
  const token = firstSearchParam(params.token);
  const redirectTo = safeRedirectPath(firstSearchParam(params.redirect) || '/');
  const [localError, setLocalError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (booting || session || attempted.current) return;
    attempted.current = true;

    let cancelled = false;
    (async () => {
      const initialUrl = await Linking.getInitialURL();
      if (cancelled) return;

      if (initialUrl && tokenFromAuthUrl(initialUrl)) {
        await handleIncomingUrl(initialUrl);
        return;
      }

      if (initialUrl && /^vmp:\/\//i.test(initialUrl) && !customSchemeDeepLinksAllowed) {
        setLocalError(
          'Custom vmp:// links are disabled in this build. Open the https:// magic link, or rebuild with EXPO_PUBLIC_ENABLE_VMP_SCHEME=1.',
        );
        return;
      }

      if (token) {
        await completeMagicLink(token);
        return;
      }

      setLocalError('Missing sign-in token in this link.');
    })();

    return () => {
      cancelled = true;
    };
  }, [booting, session, token, handleIncomingUrl, completeMagicLink]);

  if (booting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#38bdf8" />
      </View>
    );
  }

  if (session) {
    // Dynamic post-login path from the magic-link query (validated by safeRedirectPath).
    return <Redirect href={redirectTo as '/'} />;
  }

  const message = localError || error;

  return (
    <View style={styles.container}>
      {!message ? (
        <>
          <ActivityIndicator color="#38bdf8" />
          <Text style={styles.copy}>Signing you in…</Text>
        </>
      ) : (
        <>
          <Text style={styles.heading}>Sign-in link failed</Text>
          <Text style={styles.error}>{message}</Text>
          <Pressable
            style={styles.primaryBtn}
            onPress={() => {
              router.replace('/login');
            }}
          >
            <Text style={styles.primaryBtnText}>Request a new link</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 14,
    justifyContent: 'center',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { color: '#f8fafc', fontSize: 22, fontWeight: '700' },
  copy: { color: '#94a3b8', fontSize: 15, textAlign: 'center' },
  error: { color: '#f87171', fontSize: 14, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: '#38bdf8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
});
