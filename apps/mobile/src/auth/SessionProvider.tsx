import * as Linking from 'expo-linking';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getAccountSubscription } from '../api/client';
import { type AccountSubscription, isPremiumUser } from '../entitlements/premium';
import { requireActiveSubscription } from '../features';
import { isLikelyNetworkError, OFFLINE_MODE_MESSAGE } from '../network/errors';
import { tokenFromAuthUrl } from './deepLink';
import {
  clearSession,
  loadSession,
  redeemMagicLinkCode,
  redeemMagicLinkToken,
  restoreSession,
  SessionRestoreError,
  type SessionState,
  signOut,
} from './session';
import {
  clearSubscriptionCache,
  readSubscriptionCache,
  writeSubscriptionCache,
} from './subscriptionCache';

export type MagicLinkOutcome = 'authenticated' | 'two_factor_required' | 'failed' | 'ignored';

type SessionContextValue = {
  session: SessionState | null;
  booting: boolean;
  error: string | null;
  /** Pending TOTP challenge after magic-link redeem (in-memory only; ~5 min API TTL). */
  pendingTwoFactorToken: string | null;
  subscription: AccountSubscription;
  subscriptionHydrated: boolean;
  /** True when staff or active/trialing subscription (web isPremium parity). */
  isPremium: boolean;
  /**
   * When the subscriber gate is on, true only after premium is confirmed.
   * When the gate is off, always true once a session exists (tiers unlocked later).
   */
  canBrowseCatalog: boolean;
  setSession: (session: SessionState | null) => void;
  clearPendingTwoFactor: () => void;
  refreshFromStore: () => Promise<void>;
  refreshEntitlements: () => Promise<void>;
  handleIncomingUrl: (url: string | null) => Promise<MagicLinkOutcome>;
  completeMagicLink: (token: string) => Promise<MagicLinkOutcome>;
  completeEmailCode: (email: string, code: string) => Promise<MagicLinkOutcome>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<SessionState | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingTwoFactorToken, setPendingTwoFactorToken] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<AccountSubscription>(null);
  const [subscriptionHydrated, setSubscriptionHydrated] = useState(false);
  /** Bumps on each hydrate/clear so slower in-flight fetches cannot overwrite the active session. */
  const entitlementsEpochRef = useRef(0);
  /** Access token the latest hydrate/clear considers current (null when signed out). */
  const activeAccessTokenRef = useRef<string | null>(null);

  const clearEntitlements = useCallback(() => {
    entitlementsEpochRef.current += 1;
    activeAccessTokenRef.current = null;
    setSubscription(null);
    setSubscriptionHydrated(false);
  }, []);

  const hydrateEntitlements = useCallback(async (accessToken: string, userId: string) => {
    const epoch = ++entitlementsEpochRef.current;
    activeAccessTokenRef.current = accessToken;
    try {
      const data = await getAccountSubscription(accessToken);
      if (entitlementsEpochRef.current !== epoch || activeAccessTokenRef.current !== accessToken) {
        return;
      }
      const next = data.subscription ?? null;
      setSubscription(next);
      setSubscriptionHydrated(true);
      await writeSubscriptionCache(userId, next).catch(() => undefined);
    } catch (err) {
      if (entitlementsEpochRef.current !== epoch || activeAccessTokenRef.current !== accessToken) {
        return;
      }
      if (isLikelyNetworkError(err)) {
        const cached = await readSubscriptionCache(userId);
        if (
          entitlementsEpochRef.current !== epoch ||
          activeAccessTokenRef.current !== accessToken
        ) {
          return;
        }
        if (cached) {
          setSubscription(cached);
          setSubscriptionHydrated(true);
          return;
        }
      }
      setSubscription(null);
      setSubscriptionHydrated(true);
    }
  }, []);

  const setSession = useCallback(
    (next: SessionState | null) => {
      setSessionState(next);
      if (!next) {
        clearEntitlements();
        void clearSubscriptionCache().catch(() => undefined);
        return;
      }
      setSubscriptionHydrated(false);
      void hydrateEntitlements(next.accessToken, next.user.id);
    },
    [clearEntitlements, hydrateEntitlements],
  );

  const refreshEntitlements = useCallback(async () => {
    if (!session) {
      clearEntitlements();
      return;
    }
    setSubscriptionHydrated(false);
    await hydrateEntitlements(session.accessToken, session.user.id);
  }, [session, clearEntitlements, hydrateEntitlements]);

  const clearPendingTwoFactor = useCallback(() => {
    setPendingTwoFactorToken(null);
  }, []);

  const completeMagicLink = useCallback(
    async (token: string): Promise<MagicLinkOutcome> => {
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
    },
    [setSession],
  );

  const completeEmailCode = useCallback(
    async (email: string, code: string): Promise<MagicLinkOutcome> => {
      try {
        setError(null);
        const result = await redeemMagicLinkCode(email, code);
        if (result.status === 'two_factor_required') {
          await clearSession();
          setPendingTwoFactorToken(result.pendingToken);
          setSession(null);
          return 'two_factor_required';
        }
        setPendingTwoFactorToken(null);
        setSession(result.session);
        return 'authenticated';
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Confirmation code failed');
        return 'failed';
      }
    },
    [setSession],
  );

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
        setError(
          isLikelyNetworkError(err)
            ? OFFLINE_MODE_MESSAGE
            : 'Could not refresh session (will retry). Showing last known session.',
        );
        return;
      }
      setSession(null);
      setError(err instanceof Error ? err.message : 'Session restore failed');
    }
  }, [setSession]);

  const logout = useCallback(async () => {
    await signOut();
    setPendingTwoFactorToken(null);
    setSession(null);
  }, [setSession]);

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

  const isPremium = useMemo(
    () =>
      isPremiumUser({
        role: session?.user.role,
        subscription,
      }),
    [session?.user.role, subscription],
  );

  const canBrowseCatalog = useMemo(() => {
    if (!session) return false;
    if (!requireActiveSubscription) return true;
    if (!subscriptionHydrated) return false;
    return isPremium;
  }, [session, subscriptionHydrated, isPremium]);

  const value = useMemo(
    () => ({
      session,
      booting,
      error,
      pendingTwoFactorToken,
      subscription,
      subscriptionHydrated,
      isPremium,
      canBrowseCatalog,
      setSession,
      clearPendingTwoFactor,
      refreshFromStore,
      refreshEntitlements,
      handleIncomingUrl,
      completeMagicLink,
      completeEmailCode,
      logout,
    }),
    [
      session,
      booting,
      error,
      pendingTwoFactorToken,
      subscription,
      subscriptionHydrated,
      isPremium,
      canBrowseCatalog,
      clearPendingTwoFactor,
      refreshFromStore,
      refreshEntitlements,
      handleIncomingUrl,
      completeMagicLink,
      completeEmailCode,
      logout,
      setSession,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
