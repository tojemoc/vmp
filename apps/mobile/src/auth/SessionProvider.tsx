import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { tokenFromAuthUrl } from './deepLink';
import {
  clearSession,
  loadSession,
  redeemMagicLinkToken,
  restoreSession,
  SessionRestoreError,
  type SessionState,
  signOut,
} from './session';

export type MagicLinkOutcome = 'authenticated' | 'two_factor_required' | 'failed' | 'ignored';

type SessionContextValue = {
  session: SessionState | null;
  booting: boolean;
  error: string | null;
  /** Pending TOTP challenge after magic-link redeem (in-memory only; ~5 min API TTL). */
  pendingTwoFactorToken: string | null;
  setSession: (session: SessionState | null) => void;
  clearPendingTwoFactor: () => void;
  refreshFromStore: () => Promise<void>;
  handleIncomingUrl: (url: string | null) => Promise<MagicLinkOutcome>;
  completeMagicLink: (token: string) => Promise<MagicLinkOutcome>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingTwoFactorToken, setPendingTwoFactorToken] = useState<string | null>(null);

  const clearPendingTwoFactor = useCallback(() => {
    setPendingTwoFactorToken(null);
  }, []);

  const completeMagicLink = useCallback(async (token: string): Promise<MagicLinkOutcome> => {
    try {
      setError(null);
      const result = await redeemMagicLinkToken(token);
      if (result.status === 'two_factor_required') {
        // Drop any prior SecureStore session so boot cannot restore the old account
        // while the TOTP challenge is still pending (token is in-memory only).
        await clearSession();
        setPendingTwoFactorToken(result.pendingToken);
        setSession(null);
        return 'two_factor_required';
      }
      setPendingTwoFactorToken(null);
      setSession(result.session);
      return 'authenticated';
    } catch (err) {
      // Do not clear an active TOTP challenge on a later used/invalid magic-link 401.
      setError(err instanceof Error ? err.message : 'Sign-in link failed');
      return 'failed';
    }
  }, []);

  const handleIncomingUrl = useCallback(
    async (url: string | null): Promise<MagicLinkOutcome> => {
      const token = tokenFromAuthUrl(url);
      if (!token) return 'ignored';
      return completeMagicLink(token);
    },
    [completeMagicLink],
  );

  const refreshFromStore = useCallback(async () => {
    try {
      const next = await restoreSession();
      setSession(next);
    } catch (err) {
      if (err instanceof SessionRestoreError && err.retryable) {
        const cached = await loadSession();
        setSession(cached);
        setError('Could not refresh session (will retry). Showing last known session.');
        return;
      }
      setSession(null);
      setError(err instanceof Error ? err.message : 'Session restore failed');
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut();
    setPendingTwoFactorToken(null);
    setSession(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (tokenFromAuthUrl(initialUrl)) {
          const outcome = await handleIncomingUrl(initialUrl);
          // Hard failure: restore any prior secure-store session. 2FA pending keeps session null.
          if (outcome === 'failed') {
            await refreshFromStore();
          }
        } else {
          await refreshFromStore();
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    const sub = Linking.addEventListener('url', (event) => {
      void handleIncomingUrl(event.url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [handleIncomingUrl, refreshFromStore]);

  const value = useMemo(
    () => ({
      session,
      booting,
      error,
      pendingTwoFactorToken,
      setSession,
      clearPendingTwoFactor,
      refreshFromStore,
      handleIncomingUrl,
      completeMagicLink,
      logout,
    }),
    [
      session,
      booting,
      error,
      pendingTwoFactorToken,
      clearPendingTwoFactor,
      refreshFromStore,
      handleIncomingUrl,
      completeMagicLink,
      logout,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
