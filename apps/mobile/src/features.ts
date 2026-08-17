/**
 * Feature gates for Tier 1 PoC. Flip via env at build time — not runtime user settings.
 *
 * - nativePushEnabled: notification permission + registerNativePushDevice
 * - customSchemeDeepLinksAllowed: vmp:// token handoff (dev/PoC only; store builds use HTTPS)
 */
export const nativePushEnabled =
  process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === '1' ||
  process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === 'true';

/**
 * Default **off** (store-safe). Enable custom-scheme token handoff only with an
 * explicit development opt-in:
 *   EXPO_PUBLIC_ENABLE_VMP_SCHEME=1
 *   or EXPO_PUBLIC_DISABLE_VMP_SCHEME=0  (legacy opt-in spelling)
 */
export const customSchemeDeepLinksAllowed =
  process.env.EXPO_PUBLIC_ENABLE_VMP_SCHEME === '1' ||
  process.env.EXPO_PUBLIC_ENABLE_VMP_SCHEME === 'true' ||
  process.env.EXPO_PUBLIC_DISABLE_VMP_SCHEME === '0' ||
  process.env.EXPO_PUBLIC_DISABLE_VMP_SCHEME === 'false';
