import { customSchemeDeepLinksAllowed } from '../features';

const AUTH_VERIFY_PATH = '/auth/verify';
const VMP_AUTH_HOST = 'auth';
const VMP_VERIFY_PATH = '/verify';

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

/** Build-time App Link host (`EXPO_PUBLIC_FRONTEND_HOST`). Empty ⇒ HTTPS tokens rejected. */
export function configuredFrontendHost(override?: string | null): string | null {
  if (override !== undefined) {
    const trimmed = typeof override === 'string' ? override.trim() : '';
    return trimmed ? trimmed.toLowerCase() : null;
  }
  const raw = process.env.EXPO_PUBLIC_FRONTEND_HOST?.trim();
  return raw ? raw.toLowerCase() : null;
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function tokenFromQueryString(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const token = params.get('token');
  return token || null;
}

/**
 * Extract magic-link token from Universal Link or vmp:// deep link.
 *
 * HTTPS: only `https://<EXPO_PUBLIC_FRONTEND_HOST>/auth/verify?token=…`.
 * Custom: only `vmp://auth/verify?token=…` when the PoC scheme flag allows it
 * (local testing only — distributed / SideStore artifact builds force the scheme off).
 * Unrelated deep links never yield a token (SessionProvider must not redeem them).
 */
export function tokenFromAuthUrl(
  url: string | null | undefined,
  allowCustomScheme: boolean = customSchemeDeepLinksAllowed,
  expectedHttpsHost?: string | null,
): string | null {
  if (!url) return null;

  const host = configuredFrontendHost(expectedHttpsHost);

  try {
    const parsed = new URL(url);
    const path = normalizePathname(parsed.pathname);

    if (parsed.protocol === 'vmp:') {
      if (!allowCustomScheme) return null;
      if (parsed.hostname.toLowerCase() !== VMP_AUTH_HOST || path !== VMP_VERIFY_PATH) {
        return null;
      }
      return parsed.searchParams.get('token') || null;
    }

    if (parsed.protocol === 'https:') {
      if (!host || parsed.hostname.toLowerCase() !== host || path !== AUTH_VERIFY_PATH) {
        return null;
      }
      return parsed.searchParams.get('token') || null;
    }

    return null;
  } catch {
    // Fall through for non-standard URLs that still match the exact shapes.
  }

  // Fallback only after the same origin/route constraints (no arbitrary ?token= scrape).
  if (allowCustomScheme) {
    const vmp = url.match(/^vmp:\/\/auth\/verify\/?(?:\?([^#]*))?(?:#.*)?$/i);
    if (vmp) return tokenFromQueryString(vmp[1] || '');
  }

  if (host) {
    const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const https = url.match(
      new RegExp(`^https://${escapedHost}/auth/verify/?(?:\\?([^#]*))?(?:#.*)?$`, 'i'),
    );
    if (https) return tokenFromQueryString(https[1] || '');
  }

  return null;
}
