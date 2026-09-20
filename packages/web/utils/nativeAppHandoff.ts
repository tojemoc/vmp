/**
 * Browser → native app handoff for magic-link `/auth/verify`.
 *
 * Verified App / Universal Links need `/.well-known/assetlinks.json` and
 * `/.well-known/apple-app-site-association` (checklist S5). Until those are
 * live — or when an email client opens the system browser instead of the app —
 * Android can still bounce into the installed APK without consuming the
 * single-use token in the browser first:
 *
 * - **Android:** package-targeted `intent://` with the same HTTPS verify URL
 * - **iOS:** custom-scheme handoff that embeds the raw magic-link token in a
 *   `vmp://` URL is intentionally **disabled**. Any app can register `vmp://`,
 *   and install-bound / authenticated native-client keys do not exist yet
 *   (see `docs/native-clients-plan.md`). Prefer AASA Universal Links (S5) or a
 *   future short-lived handoff code bound to an app-install key.
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
