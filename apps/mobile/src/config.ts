/** Runtime config for the Tier 1 Expo PoC. */

function resolveApiUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!raw) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is required (device/emulator cannot use a hidden localhost default). Example: EXPO_PUBLIC_API_URL=http://10.0.2.2:8787',
    );
  }
  return raw.replace(/\/$/, '');
}

export const apiUrl = resolveApiUrl();

export const appScheme = 'vmp';
