import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { credentialFromAuthUrl } from './deepLink';
import {
  loadSession,
  redeemHandoffCode,
  redeemMagicLinkToken,
  restoreSession,
  SessionRestoreError,
  type SessionState,
  signOut,
} from './session';

type SessionContextValue = {
  session: SessionState | null;
  booting: boolean;
  error: string | null;
  setSession: (session: SessionState | null) => void;
  refreshFromStore: () => Promise<void>;
  handleIncomingUrl: (url: string | null) => Promise<boolean>;
  completeMagicLink: (token: string) => Promise<boolean>;
  completeHandoff: (handoffCode: string) => Promise<boolean>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const completeMagicLink = useCallback(async (token: string): Promise<boolean> => {
    try {
      setError(null);
      const next = await redeemMagicLinkToken(token);
      setSession(next);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in link failed');
      return false;
    }
  }, []);

  const completeHandoff = useCallback(async (handoffCode: string): Promise<boolean> => {
    try {
      setError(null);
      const next = await redeemHandoffCode(handoffCode);
      setSession(next);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in handoff failed');
      return false;
    }
  }, []);

  const handleIncomingUrl = useCallback(
    async (url: string | null): Promise<boolean> => {
      const cred = credentialFromAuthUrl(url);
      if (!cred) return false;
      if (cred.kind === 'token') return completeMagicLink(cred.token);
      return completeHandoff(cred.handoffCode);
    },
    [completeMagicLink, completeHandoff],
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
    setSession(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (credentialFromAuthUrl(initialUrl)) {
          const redeemed = await handleIncomingUrl(initialUrl);
          if (!redeemed) {
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
      setSession,
      refreshFromStore,
      handleIncomingUrl,
      completeMagicLink,
      completeHandoff,
      logout,
    }),
    [
      session,
      booting,
      error,
      refreshFromStore,
      handleIncomingUrl,
      completeMagicLink,
      completeHandoff,
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
