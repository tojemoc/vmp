/**
 * Same-origin path for post-auth return (magic-link `redirect` query + OTP flows).
 * Must start with `/`, must not be protocol-relative (`//…` or `/\…`), length-capped.
 */
export function safeRedirectPath(value: unknown, fallback: string): string;
export function safeRedirectPath(value: unknown, fallback?: undefined): string | undefined;
export function safeRedirectPath(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback;
  const t = value.trim();
  if (!t.startsWith('/') || t.startsWith('//') || t.startsWith('/\\') || t.length > 1024) {
    return fallback;
  }
  return t;
}

function isAuthIntermediatePath(fullPath: string): boolean {
  const pathOnly = fullPath.split('?')[0]?.split('#')[0] ?? fullPath;
  const normalized =
    pathOnly.length > 1 && pathOnly.endsWith('/') ? pathOnly.slice(0, -1) : pathOnly;
  return normalized === '/login' || normalized === '/auth' || normalized.startsWith('/auth/');
}

/**
 * Prefer an explicit redirect; otherwise the current route (so Sign in from a
 * video / article / account / checkout return lands back there after the link).
 * Never bounce back onto `/login` or `/auth` intermediates — including when
 * those paths are passed explicitly via `?redirect=`.
 */
export function resolveAuthReturnPath(
  explicit: unknown,
  currentFullPath: string | undefined,
): string | undefined {
  const sanitizedExplicit = safeRedirectPath(explicit);
  const candidate = sanitizedExplicit ?? safeRedirectPath(currentFullPath);
  if (!candidate) return undefined;
  if (isAuthIntermediatePath(candidate)) return undefined;
  return candidate;
}
