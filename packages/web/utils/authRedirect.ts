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

/**
 * Prefer an explicit redirect; otherwise the current route (so Sign in from a
 * video / article / account / checkout return lands back there after the link).
 * Never bounce back onto `/login` or `/auth` intermediates.
 */
export function resolveAuthReturnPath(
  explicit: unknown,
  currentFullPath: string | undefined,
): string | undefined {
  const fromQuery = safeRedirectPath(explicit);
  if (fromQuery) return fromQuery;
  if (!currentFullPath) return undefined;
  const pathOnly = currentFullPath.split('?')[0]?.split('#')[0] ?? currentFullPath;
  const normalized =
    pathOnly.length > 1 && pathOnly.endsWith('/') ? pathOnly.slice(0, -1) : pathOnly;
  if (normalized === '/login' || normalized === '/auth' || normalized.startsWith('/auth/')) {
    return undefined;
  }
  return safeRedirectPath(currentFullPath);
}
