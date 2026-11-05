/**
 * Query params that carry a redeemable credential: the single-use magic-link `token`,
 * short-lived PWA `handoff` code, and push-login `pwa_auth_handoff` code.
 * Telemetry must never see them.
 *
 * Fed to posthog-js `custom_personal_data_properties` (masks `$current_url` & co.) — a plain
 * array, because `@posthog/nuxt` ships `clientConfig` as JSON and drops functions such as
 * `before_send`. Browser logs read `location.href` unmasked, so a client plugin strips these
 * params before telemetry initializes; the credentials remain available in the router query.
 */
export const AUTH_URL_CREDENTIAL_PARAMS = ['token', 'handoff', 'pwa_auth_handoff'] as const;

/** `href` without credential params; relative input stays relative. */
export function stripAuthUrlCredentials(href: string): string {
  const url = new URL(href, 'http://relative.invalid');
  for (const param of AUTH_URL_CREDENTIAL_PARAMS) url.searchParams.delete(param);
  if (url.origin === 'http://relative.invalid') return `${url.pathname}${url.search}${url.hash}`;
  return url.toString();
}

/** Absolute `href` with the in-memory magic-link token put back (native handoff needs it). */
export function withMagicLinkToken(href: string, token: string): string {
  const url = new URL(href);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Replace the address-bar URL with one that has no credential params (keeps router state). */
export function hideAuthUrlCredentialsFromAddressBar(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  const current = `${pathname}${search}${hash}`;
  const stripped = stripAuthUrlCredentials(current);
  if (stripped === current) return;
  try {
    const state = window.history.state;
    const sanitizedState =
      state && typeof state === 'object' ? { ...state, current: stripped } : state;
    window.history.replaceState(sanitizedState, '', stripped);
  } catch {
    // Never let URL hygiene break sign-in.
  }
}
