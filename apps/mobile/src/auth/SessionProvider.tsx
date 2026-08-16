import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  loadSession,
  redeemMagicLinkToken,
  restoreSession,
  SessionRestoreError,
  type SessionState,
  signOut,
  tokenFromAuthUrl,
} from './session';

type SessionContextValue = {
  session: SessionState | null;
  booting: boolean;
  error: string | null;
  setSession: (session: SessionState | null) => void;
  refreshFromStore: () => Promise<void>;
  handleIncomingUrl: (url: string | null) => Promise<boolean>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleIncomingUrl = useCallback(async (url: string | null): Promise<boolean> => {
    const token = tokenFromAuthUrl(url);
    if (!token) return false;
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
        if (tokenFromAuthUrl(initialUrl)) {
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
      logout,
    }),
    [session, booting, error, refreshFromStore, handleIncomingUrl, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
