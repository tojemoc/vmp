/**
 * Browser → native app handoff for magic-link `/auth/verify`.
 *
 * Verified App / Universal Links need `/.well-known/assetlinks.json` and
 * `/.well-known/apple-app-site-association` (checklist S5). Until those are
 * live — or when an email client opens the system browser instead of the app —
 * the browser can still bounce into the installed native client:
 *
 * - **Android:** package-targeted `intent://` with the same HTTPS verify URL
 *   (token still unconsumed).
 * - **iOS (SideStore / PoC):** Safari first exchanges the magic-link token for a
 *   short-lived one-time handoff code, then opens
 *   `vmp://auth/verify?handoff=…`. Raw email tokens are never placed in
 *   `vmp://` (claimable scheme). Store builds still prefer AASA (S5); install-bound
 *   handoff keys remain a later hardening step.
 */

/** Query flag that skips auto native bounce and allows web redeem. */
export const NATIVE_APP_FALLBACK_QUERY = 'native_fallback';

export const DEFAULT_MOBILE_ANDROID_PACKAGE = 'sk.tjm.vmp';

export function isNativeAppFallbackQuery(value: unknown): boolean {
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0] === '1' || value[0].toLowerCase() === 'true';
  }
  return false;
}

/**
 * Build a browser-fallback URL that keeps the magic-link token but opts out of
 * another automatic intent redirect (avoids loops when the app is missing).
 */
export function withNativeAppFallbackParam(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.searchParams.set(NATIVE_APP_FALLBACK_QUERY, '1');
  return url.toString();
}

/**
 * Android Intent URL that opens the installed package with the HTTPS verify URL.
 * Explicit `package=` works even when Digital Asset Links autoVerify has not
 * succeeded (sideloaded / PoC APKs).
 */
const ANDROID_PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9._]*$/;

export function resolveMobileAndroidPackage(packageName: string | null | undefined): string {
  const trimmed = typeof packageName === 'string' ? packageName.trim() : '';
  if (trimmed && ANDROID_PACKAGE_NAME.test(trimmed)) return trimmed;
  return DEFAULT_MOBILE_ANDROID_PACKAGE;
}

export function buildAndroidNativeAppIntentUrl(
  pageUrl: string,
  packageName: string = DEFAULT_MOBILE_ANDROID_PACKAGE,
): string {
  const safePackage = resolveMobileAndroidPackage(packageName);
  const absolute = new URL(pageUrl);
  if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:') {
    throw new Error('Native app intent requires an http(s) page URL');
  }
  const withoutScheme = absolute.href.replace(/^https?:\/\//i, '');
  const fallback = encodeURIComponent(withNativeAppFallbackParam(absolute.href));
  return `intent://${withoutScheme}#Intent;scheme=${absolute.protocol.slice(0, -1)};package=${safePackage};S.browser_fallback_url=${fallback};end`;
}

/** Navigate to the package-targeted intent; returns false off-window or on failure. */
export function openAndroidNativeApp(
  pageUrl: string,
  packageName: string = DEFAULT_MOBILE_ANDROID_PACKAGE,
): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.location.assign(
      buildAndroidNativeAppIntentUrl(pageUrl, resolveMobileAndroidPackage(packageName)),
    );
    return true;
  } catch {
    return false;
  }
}

/** Same-app redirect path only (mirrors verify.vue / mobile deepLink). */
function safeHandoffRedirect(value: string | undefined): string {
  if (typeof value !== 'string') return '/';
  const t = value.trim();
  if (!t.startsWith('/') || t.startsWith('//') || t.length > 1024) return '/';
  return t;
}

/**
 * iOS custom-scheme URL carrying a short-lived handoff code (not the email token).
 * Requires a SideStore/PoC build with `EXPO_PUBLIC_ENABLE_VMP_SCHEME=1`.
 */
export function buildIosNativeAppHandoffUrl(
  handoffCode: string,
  redirect: string = '/',
): string {
  const code = handoffCode.trim();
  if (!code) throw new Error('Native app handoff requires a handoff code');
  const params = new URLSearchParams();
  params.set('handoff', code);
  const safeRedirect = safeHandoffRedirect(redirect);
  if (safeRedirect !== '/') params.set('redirect', safeRedirect);
  return `vmp://auth/verify?${params.toString()}`;
}

/** Open the installed iOS native app with a one-time handoff code. */
export function openIosNativeAppWithHandoff(
  handoffCode: string,
  redirect: string = '/',
): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.location.assign(buildIosNativeAppHandoffUrl(handoffCode, redirect));
    return true;
  } catch {
    return false;
  }
}
