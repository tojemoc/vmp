import type { NativeAuthUser, NativeSessionResponse } from '@vmp/shared';
import * as SecureStore from 'expo-secure-store';
import { ApiError, logoutNative, redeemNativeMagicLink, refreshNativeSession } from '../api/client';

const ACCESS_KEY = 'vmp.accessToken';
const REFRESH_KEY = 'vmp.refreshToken';
const USER_KEY = 'vmp.user';

/** Deduplicate concurrent redeems of the same single-use token (cold start + route). */
let redeemInFlightToken: string | null = null;
let redeemInFlight: Promise<SessionState> | null = null;

export type SessionState = {
  accessToken: string;
  refreshToken: string;
  user: NativeAuthUser;
};

export class SessionRestoreError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

async function writeSession(session: SessionState): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, session.accessToken);
  await SecureStore.setItemAsync(REFRESH_KEY, session.refreshToken);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function loadSession(): Promise<SessionState | null> {
  const accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  const userRaw = await SecureStore.getItemAsync(USER_KEY);
  if (!accessToken || !refreshToken || !userRaw) return null;
  try {
    return { accessToken, refreshToken, user: JSON.parse(userRaw) as NativeAuthUser };
  } catch {
    await clearSession();
    return null;
  }
}

export async function persistNativeSession(session: NativeSessionResponse): Promise<SessionState> {
  const next: SessionState = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: session.user,
  };
  await writeSession(next);
  return next;
}

/**
 * Refresh against the server. Clears local session only on definitive 401.
 * Network/5xx leave the stored session intact and throw a retryable error.
 */
export async function restoreSession(): Promise<SessionState | null> {
  const existing = await loadSession();
  if (!existing) return null;
  try {
    const refreshed = await refreshNativeSession(existing.refreshToken);
    return persistNativeSession(refreshed);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await clearSession();
      return null;
    }
    throw new SessionRestoreError(
      err instanceof Error ? err.message : 'Session refresh failed',
      true,
    );
  }
}

export async function redeemMagicLinkToken(token: string): Promise<SessionState> {
  if (redeemInFlight && redeemInFlightToken === token) {
    return redeemInFlight;
  }
  redeemInFlightToken = token;
  redeemInFlight = (async () => {
    try {
      const session = await redeemNativeMagicLink(token);
      if ('requiresTwoFactor' in session && session.requiresTwoFactor) {
        throw new Error(
          'Two-factor authentication is required. Native TOTP entry is not in this PoC — use a viewer account without 2FA, or sign in on web.',
        );
      }
      if (!('refreshToken' in session) || !session.refreshToken) {
        throw new Error('Native redeem did not return a refreshToken');
      }
      return persistNativeSession(session);
    } finally {
      if (redeemInFlightToken === token) {
        redeemInFlightToken = null;
        redeemInFlight = null;
      }
    }
  })();
  return redeemInFlight;
}

export async function signOut(): Promise<void> {
  const existing = await loadSession();
  if (existing?.refreshToken) {
    try {
      await logoutNative(existing.refreshToken);
    } catch {
      // Local clear still proceeds.
    }
  }
  await clearSession();
}

export { firstSearchParam, safeRedirectPath, tokenFromAuthUrl } from './deepLink';
