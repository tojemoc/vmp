/** True on iPhone/iPad (including iPadOS desktop UA). */
export function isIosLike(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const touchMac = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || touchMac;
}

/** Installed PWA on iOS — push-login handoff is required there; Android/Chromium can use normal magic links. */
export function isIosInstalledPwa(): boolean {
  return isInstalledPwa() && isIosLike();
}

/** True when running as an installed Home Screen / standalone PWA. */
export function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false;

  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches === true;
  const displayModeFullscreen = window.matchMedia?.('(display-mode: fullscreen)').matches === true;
  const displayModeMinimalUi = window.matchMedia?.('(display-mode: minimal-ui)').matches === true;
  const displayModeWco =
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches === true;

  return (
    iosStandalone ||
    displayModeStandalone ||
    displayModeFullscreen ||
    displayModeMinimalUi ||
    displayModeWco
  );
}

/**
 * Platforms where offline-download UI is worth showing outside the installed app:
 * iOS can Add to Home Screen; Chromium installability is checked separately via `$pwa.showInstallPrompt`.
 */
export function canAddToHomeScreenWithoutPrompt(): boolean {
  return isIosLike() && !isInstalledPwa();
}

/** True on Android phones/tablets — Chrome intent URLs are reliable there. */
export function isAndroid(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android/i.test(window.navigator.userAgent);
}

/**
 * Try opening the current page in Chrome via an Android intent URL.
 * Returns false when the platform does not support this handoff.
 */
export function openCurrentPageInChrome(): boolean {
  if (!isAndroid() || typeof window === 'undefined') return false;
  try {
    const pageUrl = window.location.href;
    const withoutScheme = pageUrl.replace(/^https?:\/\//i, '');
    const fallback = encodeURIComponent(pageUrl);
    window.location.assign(
      `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`,
    );
    return true;
  } catch {
    return false;
  }
}

export function canOpenCurrentPageInChrome(): boolean {
  return isAndroid();
}

const DEVICE_TOKEN_KEY = 'vmp_pwa_device_token';
export const PWA_LOGIN_EMAIL_KEY = 'vmp_pwa_login_email';
let fallbackDeviceToken: string | null = null;

/** Stable per-browser id for anonymous PWA push-login attempts. */
export function getOrCreatePwaDeviceToken(): string {
  if (import.meta.server) return '';
  try {
    const existing = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (existing && existing.length > 0) return existing;
    const token = crypto.randomUUID();
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
    return token;
  } catch {
    if (!fallbackDeviceToken) fallbackDeviceToken = crypto.randomUUID();
    return fallbackDeviceToken;
  }
}
