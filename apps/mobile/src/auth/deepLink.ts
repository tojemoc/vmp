import { customSchemeDeepLinksAllowed } from '../features';

/**
 * Safe in-app redirect after magic-link redeem.
 * Must be a same-app path: starts with `/`, not `//`, length-capped.
 */
export function safeRedirectPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  const t = value.trim();
  if (!t.startsWith('/') || t.startsWith('//') || t.length > 1024) return fallback;
  return t;
}

/** First string from Expo Router search params (string | string[]). */
export function firstSearchParam(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
}

/**
 * Extract magic-link token from Universal Link or vmp:// deep link.
 * `allowCustomScheme` defaults to the build-time PoC flag.
 */
export function tokenFromAuthUrl(
  url: string | null | undefined,
  allowCustomScheme: boolean = customSchemeDeepLinksAllowed,
): string | null {
  if (!url) return null;
  if (!allowCustomScheme && /^vmp:\/\//i.test(url)) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token');
    if (token) return token;
  } catch {
    // Fall through for non-standard URLs.
  }
  const match = url.match(/[?&]token=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
