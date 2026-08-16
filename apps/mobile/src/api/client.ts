import type { NativeRedeemResponse, NativeSessionResponse } from '@vmp/shared';
import { apiUrl } from '../config';

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

export async function requestMagicLink(email: string, redirect = '/'): Promise<void> {
  await apiFetch('/api/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify({ email, redirect }),
  });
}

export async function redeemNativeMagicLink(token: string): Promise<NativeRedeemResponse> {
  return apiFetch('/api/auth/native/redeem', {
    method: 'POST',
    body: JSON.stringify({ token }),
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
  return apiFetch(
    '/api/push/device',
    { method: 'POST', body: JSON.stringify(payload) },
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
