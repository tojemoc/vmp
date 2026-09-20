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

export type AuthDeepLinkCredential =
  | { kind: 'token'; token: string }
  | { kind: 'handoff'; handoffCode: string };

function credentialFromSearchParams(params: URLSearchParams): AuthDeepLinkCredential | null {
  const token = params.get('token')?.trim() || '';
  if (token) return { kind: 'token', token };
  const handoff = params.get('handoff')?.trim() || '';
  if (handoff) return { kind: 'handoff', handoffCode: handoff };
  return null;
}

function credentialFromQueryString(search: string): AuthDeepLinkCredential | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return credentialFromSearchParams(params);
}

/**
 * Extract magic-link token or handoff code from Universal Link or vmp:// deep link.
 *
 * HTTPS: `https://<EXPO_PUBLIC_FRONTEND_HOST>/auth/verify?token=…` or `?handoff=…`.
 * Custom: `vmp://auth/verify?token=…` or `?handoff=…` when the PoC scheme flag allows it.
 * Prefer `token` when both are present. Unrelated deep links yield null.
 */
export function credentialFromAuthUrl(
  url: string | null | undefined,
  allowCustomScheme: boolean = customSchemeDeepLinksAllowed,
  expectedHttpsHost?: string | null,
): AuthDeepLinkCredential | null {
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
      return credentialFromSearchParams(parsed.searchParams);
    }

    if (parsed.protocol === 'https:') {
      if (!host || parsed.hostname.toLowerCase() !== host || path !== AUTH_VERIFY_PATH) {
        return null;
      }
      return credentialFromSearchParams(parsed.searchParams);
    }

    return null;
  } catch {
    // Fall through for non-standard URLs that still match the exact shapes.
  }

  if (allowCustomScheme) {
    const vmp = url.match(/^vmp:\/\/auth\/verify\/?(?:\?([^#]*))?(?:#.*)?$/i);
    if (vmp) return credentialFromQueryString(vmp[1] || '');
  }

  if (host) {
    const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const https = url.match(
      new RegExp(`^https://${escapedHost}/auth/verify/?(?:\\?([^#]*))?(?:#.*)?$`, 'i'),
    );
    if (https) return credentialFromQueryString(https[1] || '');
  }

  return null;
}

/**
 * Extract magic-link token only (legacy helper). Prefer `credentialFromAuthUrl`.
 */
export function tokenFromAuthUrl(
  url: string | null | undefined,
  allowCustomScheme: boolean = customSchemeDeepLinksAllowed,
  expectedHttpsHost?: string | null,
): string | null {
  const cred = credentialFromAuthUrl(url, allowCustomScheme, expectedHttpsHost);
  return cred?.kind === 'token' ? cred.token : null;
}
