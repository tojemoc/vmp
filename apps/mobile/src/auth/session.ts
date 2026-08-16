import type { NativeAuthUser, NativeSessionResponse } from '@vmp/shared';
import * as SecureStore from 'expo-secure-store';
import { logoutNative, redeemNativeMagicLink, refreshNativeSession } from '../api/client';

const ACCESS_KEY = 'vmp.accessToken';
const REFRESH_KEY = 'vmp.refreshToken';
const USER_KEY = 'vmp.user';

export type SessionState = {
  accessToken: string;
  refreshToken: string;
  user: NativeAuthUser;
};

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

export async function restoreSession(): Promise<SessionState | null> {
  const existing = await loadSession();
  if (!existing) return null;
  try {
    const refreshed = await refreshNativeSession(existing.refreshToken);
    return persistNativeSession(refreshed);
  } catch {
    await clearSession();
    return null;
  }
}

export async function redeemMagicLinkToken(token: string): Promise<SessionState> {
  const session = await redeemNativeMagicLink(token);
  if (!('refreshToken' in session) || !session.refreshToken) {
    throw new Error('Native redeem did not return a refreshToken');
  }
  return persistNativeSession(session);
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

/** Extract magic-link token from Universal Link or vmp:// deep link. */
export function tokenFromAuthUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token');
    if (token) return token;
  } catch {
    // Fall through for non-standard URLs.
  }
  const match = url.match(/[?&]token=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
