/**
 * Feature gates for Tier 1 PoC. Flip via env at build time — not runtime user settings.
 *
 * - nativePushEnabled: notification permission + registerNativePushDevice
 * - customSchemeDeepLinksAllowed: vmp:// token handoff (dev/PoC only; store builds use HTTPS)
 */
export const nativePushEnabled =
  process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === '1' ||
  process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === 'true';

/** Default true for local PoC; set EXPO_PUBLIC_DISABLE_VMP_SCHEME=1 before store builds. */
export const customSchemeDeepLinksAllowed =
  process.env.EXPO_PUBLIC_DISABLE_VMP_SCHEME !== '1' &&
  process.env.EXPO_PUBLIC_DISABLE_VMP_SCHEME !== 'true';
