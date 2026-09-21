/**
 * Feature gates for Tier 1 PoC. Flip via env at build time — not runtime user settings.
 *
 * - nativePushEnabled: notification permission + registerNativePushDevice
 * - customSchemeDeepLinksAllowed: vmp:// token handoff (fail-closed; local opt-in or
 *   Mobile artifacts flavor=development + enable_custom_scheme for staging SideStore PoC)
 * - requireActiveSubscription: app-level subscriber gate (default on; see mobile-access-tiers plan)
 */
export const nativePushEnabled =
  process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === '1' ||
  process.env.EXPO_PUBLIC_NATIVE_PUSH_ENABLED === 'true';

function envFlagTrue(name: string): boolean {
  return process.env[name] === '1' || process.env[name] === 'true';
}

function envFlagFalse(name: string): boolean {
  return process.env[name] === '0' || process.env[name] === 'false';
}

/**
 * When true (default), catalog / watch / downloads / TV pairing require an active
 * subscription (or staff role). Set `EXPO_PUBLIC_REQUIRE_ACTIVE_SUBSCRIPTION=0`
 * only when unlocking web-parity free/anonymous tiers (`mobile-access-tiers`).
 */
export const requireActiveSubscription = !envFlagFalse('EXPO_PUBLIC_REQUIRE_ACTIVE_SUBSCRIPTION');

/**
 * Custom `vmp://` handling is fail-closed unless the build opts in.
 *
 * Canonical opt-in: `EXPO_PUBLIC_ENABLE_VMP_SCHEME=1` (or `true`).
 * Kill switch: `EXPO_PUBLIC_DISABLE_VMP_SCHEME=1` (or `true`) always wins,
 * including when both flags are set.
 *
 * Unset, empty, `0`, `false`, or any other value is treated as off.
 * `DISABLE=0` is not an opt-in. Store/EAS production builds must omit
 * ENABLE (and may set DISABLE=1).
 */
export const customSchemeDeepLinksAllowed =
  envFlagTrue('EXPO_PUBLIC_ENABLE_VMP_SCHEME') && !envFlagTrue('EXPO_PUBLIC_DISABLE_VMP_SCHEME');
