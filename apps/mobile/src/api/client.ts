import type {
  NativeRedeemResponse,
  NativeSessionResponse,
  NativeTotpVerifyResponse,
  OfflineAuthorizeResponse,
  OfflineDeviceRegistration,
  OfflineRendition,
} from '@vmp/shared';
import { apiUrl } from '../config';
import { nativePushEnabled } from '../features';
import { DEVICE_TOKEN_HEADER } from '../offline/constants';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function apiFetch(path: string, init: RequestInit = {}, accessToken?: string | null) {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const res = await fetch(`${apiUrl}${path}`, { ...init, headers });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || res.statusText || 'Request failed', data?.code);
  }
  return data;
}

export async function requestMagicLink(
  email: string,
  redirect = '/',
  client: 'native' | 'browser' | 'pwa' = 'native',
): Promise<void> {
  await apiFetch('/api/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify({ email, redirect, client }),
  });
}

export async function redeemNativeMagicLink(token: string): Promise<NativeRedeemResponse> {
  return apiFetch('/api/auth/native/redeem', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function verifyNativeTotp(
  pendingToken: string,
  code: string,
): Promise<NativeTotpVerifyResponse> {
  return apiFetch('/api/auth/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ pendingToken, code }),
  });
}

export async function refreshNativeSession(refreshToken: string): Promise<NativeSessionResponse> {
  return apiFetch('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export async function logoutNative(refreshToken: string): Promise<void> {
  await apiFetch('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export async function listPublishedVideos(accessToken: string) {
  return apiFetch('/api/videos', { method: 'GET' }, accessToken);
}

export type AccountSubscriptionResponse = {
  subscription: {
    id: string;
    planType: string;
    status: string;
    currentPeriodEnd: string | null;
    provider?: string;
  } | null;
};

/** Same entitlement source as the web account page. */
export async function getAccountSubscription(
  accessToken: string,
): Promise<AccountSubscriptionResponse> {
  return apiFetch('/api/account/subscription', { method: 'GET' }, accessToken);
}

export type RecommendationVideo = {
  id: string;
  slug?: string | null;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  full_duration?: number;
  preview_duration?: number;
};

export async function getVideoRecommendations(
  videoId: string,
  accessToken: string,
  limit = 8,
): Promise<{ videos: RecommendationVideo[] }> {
  const q = new URLSearchParams({
    videoId,
    limit: String(limit),
  });
  return apiFetch(`/api/recommendations?${q.toString()}`, { method: 'GET' }, accessToken);
}

/** Preferred path: JWT supplies userId (see handleVideoAccess). */
export async function getVideoAccess(videoId: string, accessToken: string) {
  return apiFetch(
    `/api/video-access/${encodeURIComponent(videoId)}`,
    { method: 'GET' },
    accessToken,
  );
}

export async function registerNativePushDevice(
  accessToken: string,
  payload: { platform: 'ios' | 'android'; token: string; deviceId?: string },
) {
  if (!nativePushEnabled) {
    throw new Error(
      'Native push is disabled (set EXPO_PUBLIC_NATIVE_PUSH_ENABLED when delivery ships).',
    );
  }
  return apiFetch(
    '/api/push/device',
    { method: 'POST', body: JSON.stringify(payload) },
    accessToken,
  );
}

export async function unregisterNativePushDevice(
  accessToken: string,
  payload: { token?: string; deviceId?: string },
) {
  if (!nativePushEnabled) {
    throw new Error(
      'Native push is disabled (set EXPO_PUBLIC_NATIVE_PUSH_ENABLED when delivery ships).',
    );
  }
  return apiFetch(
    '/api/push/device',
    { method: 'DELETE', body: JSON.stringify(payload) },
    accessToken,
  );
}

export async function previewDevicePairing(accessToken: string, pairingCode: string) {
  return apiFetch(
    '/api/auth/device-pairing/preview',
    { method: 'POST', body: JSON.stringify({ pairingCode }) },
    accessToken,
  );
}

export async function completeDevicePairing(accessToken: string, pairingCode: string) {
  return apiFetch(
    '/api/auth/device-pairing/complete',
    { method: 'POST', body: JSON.stringify({ pairingCode }) },
    accessToken,
  );
}

export async function registerOfflineDevice(
  accessToken: string,
  payload: { deviceName: string; publicKey?: string },
): Promise<OfflineDeviceRegistration> {
  return apiFetch(
    '/api/offline/devices/register',
    { method: 'POST', body: JSON.stringify(payload) },
    accessToken,
  );
}

export async function authorizeOfflineDownload(
  accessToken: string,
  videoId: string,
  payload: { rendition: OfflineRendition; deviceId: string; deviceToken: string },
): Promise<OfflineAuthorizeResponse> {
  return apiFetch(
    `/api/downloads/${encodeURIComponent(videoId)}/authorize`,
    {
      method: 'POST',
      headers: { [DEVICE_TOKEN_HEADER]: payload.deviceToken },
      body: JSON.stringify({ rendition: payload.rendition, deviceId: payload.deviceId }),
    },
    accessToken,
  );
}

export function buildOfflineAssetUrl(
  videoId: string,
  relativePath: string,
  downloadToken: string,
): string {
  const encodedPath = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${apiUrl}/api/downloads/${encodeURIComponent(videoId)}/assets/${encodedPath}?dt=${encodeURIComponent(downloadToken)}`;
}

export async function revokeOfflineDownload(accessToken: string, videoId: string): Promise<void> {
  await apiFetch(
    `/api/downloads/${encodeURIComponent(videoId)}`,
    { method: 'DELETE', body: JSON.stringify({}) },
    accessToken,
  );
}
