/**
 * First-party CMS pageview beacon (editor analytics in /admin → Analytics).
 * Not PostHog — pairs with POST /api/analytics/pageview + D1 cms_page_view_*.
 */

const CLIENT_SESSION_STORAGE_KEY = 'vmp_cms_pageview_session';

function readOrCreateClientSessionId(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const existing = sessionStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
    if (existing && existing.length <= 64) return existing;
    let next: string;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      next = crypto.randomUUID();
    } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      next = `s-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    } else {
      return null;
    }
    sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return null;
  }
}

export type CmsPageViewPayload = {
  pageId: string;
  slug?: string | null;
  path?: string | null;
  apiUrl: string;
  authHeader?: Record<string, string>;
};

/**
 * Fire-and-forget pageview for a published CMS page. Safe to call from onMounted.
 * Skips when preview query is set or pageId is missing.
 */
export async function trackCmsPageView(input: CmsPageViewPayload): Promise<void> {
  if (typeof window === 'undefined') return;
  const pageId = String(input.pageId || '').trim();
  if (!pageId) return;
  if (new URLSearchParams(window.location.search).get('preview') === '1') return;

  const apiUrl = String(input.apiUrl || '').replace(/\/$/, '');
  if (!apiUrl) return;

  const clientSessionId = readOrCreateClientSessionId();
  const body = JSON.stringify({
    pageId,
    path: input.path || window.location.pathname || `/${input.slug || ''}`,
    referer: typeof document !== 'undefined' ? document.referrer || '' : '',
    clientSessionId,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(input.authHeader || {}),
  };

  try {
    await fetch(`${apiUrl}/api/analytics/pageview`, {
      method: 'POST',
      headers,
      body,
      credentials: 'include',
      keepalive: true,
    });
  } catch {
    // Best-effort beacon — never block page render on analytics failures.
  }
}
