import { DEVICE_TOKEN_HEADER } from './constants'
import { readStoredDevice, writeStoredDevice } from './idb'
import type { StoredDevice } from './types'

function defaultDeviceName(): string {
  if (typeof navigator === 'undefined') return 'VMP device'
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android device'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows PC'
  return 'VMP device'
}

export async function ensureOfflineDevice(
  apiUrl: string,
  authHeaders: Record<string, string>,
  deviceName = defaultDeviceName(),
): Promise<StoredDevice> {
  const existing = await readStoredDevice()
  if (existing?.deviceToken && existing.deviceId) return existing

  const res = await fetch(`${apiUrl}/api/offline/devices/register`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({ deviceName }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || 'Failed to register offline device')
  }

  const device: StoredDevice = {
    deviceId: data.deviceId,
    deviceToken: data.deviceToken,
    deviceName: data.deviceName ?? deviceName,
    registeredAt: data.registeredAt ?? new Date().toISOString(),
  }
  await writeStoredDevice(device)
  return device
}

export function deviceAuthHeaders(device: StoredDevice): Record<string, string> {
  return { [DEVICE_TOKEN_HEADER]: device.deviceToken }
}
