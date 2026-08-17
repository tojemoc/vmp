/**
 * Feature gates for Tier 1 PoC. Flip via env at build time — not runtime user settings.
 *
 * Keep `nativePushEnabled` false until APNs/FCM delivery ships; any code that calls
 * `registerNativePushDevice` or requests notification permission MUST check this first.
 */
export const nativePushEnabled =
  process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === '1' ||
  process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === 'true';
