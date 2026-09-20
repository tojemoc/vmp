import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { registerOfflineDevice } from '../api/client';
import { DEVICE_SECURE_KEY, DEVICE_TOKEN_HEADER } from './constants';
import type { StoredDevice } from './types';

function defaultDeviceName(): string {
  if (Platform.OS === 'ios') return 'iPhone';
  if (Platform.OS === 'android') return 'Android device';
  return 'VMP device';
}

export async function readStoredDevice(): Promise<StoredDevice | null> {
  const raw = await SecureStore.getItemAsync(DEVICE_SECURE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDevice;
    if (parsed?.deviceId && parsed?.deviceToken) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function writeStoredDevice(device: StoredDevice): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_SECURE_KEY, JSON.stringify(device));
}

export async function ensureOfflineDevice(
  accessToken: string,
  deviceName = defaultDeviceName(),
): Promise<StoredDevice> {
  const existing = await readStoredDevice();
  if (existing?.deviceToken && existing.deviceId) return existing;

  const data = await registerOfflineDevice(accessToken, { deviceName });
  const deviceId = typeof data.deviceId === 'string' ? data.deviceId.trim() : '';
  const deviceToken = typeof data.deviceToken === 'string' ? data.deviceToken.trim() : '';
  if (!deviceId || !deviceToken) {
    throw new Error('Invalid device registration response');
  }

  const device: StoredDevice = {
    deviceId,
    deviceToken,
    deviceName: data.deviceName ?? deviceName,
    registeredAt: data.registeredAt ?? new Date().toISOString(),
  };
  await writeStoredDevice(device);
  return device;
}

export function deviceAuthHeaders(device: StoredDevice): Record<string, string> {
  return { [DEVICE_TOKEN_HEADER]: device.deviceToken };
}
