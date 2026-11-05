/**
 * Paths visitors (and crawlers) guess on the web origin that the app has no page for.
 * Without a server route they fall into the CMS catch-all `pages/[slug].vue`, which
 * renders a full Nuxt error page for what is really a feed or crawler request.
 */

/** Where `/rss` should send podcast clients and browsers: the API's public feed. */
export function publicRssFeedUrl(apiUrl: string | undefined | null): string | null {
  const base = String(apiUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}/api/feed/public`;
}

/** Title key for `error.vue`; only the status code may drive markup so SSR and hydration agree. */
export function errorPageTitleKey(
  statusCode: number | undefined,
): 'errorPageNotFound' | 'errorPageUnavailable' {
  return statusCode !== undefined && statusCode >= 400 && statusCode < 500
    ? 'errorPageNotFound'
    : 'errorPageUnavailable';
}
