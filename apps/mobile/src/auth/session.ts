import type { NativeAuthUser, NativeSessionResponse } from '@vmp/shared';
import * as SecureStore from 'expo-secure-store';
import {
  ApiError,
  logoutNative,
  redeemNativeMagicLink,
  refreshNativeSession,
  verifyNativeTotp,
} from '../api/client';
import { clearStoredDevice } from '../offline/device';
import { shareInFlightByKey } from './inFlight';
import { normalizeTotpCode, TotpVerifyError } from './totp';

export { isTotpSessionExpired, normalizeTotpCode, TotpVerifyError } from './totp';

const ACCESS_KEY = 'vmp.accessToken';
const REFRESH_KEY = 'vmp.refreshToken';
const USER_KEY = 'vmp.user';

/** Per-token in-flight redeem promises (cold start + route; independent across tokens). */
const redeemInFlightByKey = new Map<string, Promise<RedeemMagicLinkResult>>();

export type SessionState = {
  accessToken: string;
  refreshToken: string;
  user: NativeAuthUser;
};

export type RedeemMagicLinkResult =
  | { status: 'authenticated'; session: SessionState }
  | { status: 'two_factor_required'; pendingToken: string };

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

export async function redeemMagicLinkToken(token: string): Promise<RedeemMagicLinkResult> {
  return shareInFlightByKey(redeemInFlightByKey, `token:${token}`, async () => {
    const session = await redeemNativeMagicLink(token);
    if ('requiresTwoFactor' in session && session.requiresTwoFactor) {
      if (!session.pendingToken) {
        throw new Error(
          'Two-factor authentication is required, but no pending token was returned.',
        );
      }
      return { status: 'two_factor_required', pendingToken: session.pendingToken };
    }
    if (!('refreshToken' in session) || !session.refreshToken) {
      throw new Error('Native redeem did not return a refreshToken');
    }
    return { status: 'authenticated', session: await persistNativeSession(session) };
  });
}

export async function completeTotpLogin(pendingToken: string, code: string): Promise<SessionState> {
  const digits = normalizeTotpCode(code);
  if (!digits) {
    throw new TotpVerifyError('Enter the 6-digit authenticator code.', 400);
  }
  try {
    const session = await verifyNativeTotp(pendingToken, digits);
    if (!session.refreshToken) {
      throw new TotpVerifyError('Verification succeeded but no refresh token was returned.', 500);
    }
    return persistNativeSession(session);
  } catch (err) {
    if (err instanceof ApiError) {
      throw new TotpVerifyError(err.message, err.status, err.code);
    }
    throw err;
  }
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
  await clearStoredDevice();
}

export { firstSearchParam, safeRedirectPath, tokenFromAuthUrl } from './deepLink';
