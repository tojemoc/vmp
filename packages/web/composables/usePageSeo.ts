/**
 * Sets document title and Open Graph / Twitter Card meta tags for SSR and CSR.
 * Crawlers (Facebook, Slack, opengraph.xyz) read these from the initial HTML.
 */

import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { sizeUrl } from '~/composables/useThumbnail';

export type PageSeoInput = {
  /** Page-specific title (e.g. video title). Shown as og:title. */
  title?: string;
  description?: string;
  /** Absolute or site-relative image URL. */
  image?: string | null;
  ogType?: 'website' | 'article' | 'video.other';
  /** When true, adds robots noindex (account, login, etc.). */
  noIndex?: boolean;
};

function stripForMeta(raw: string, maxLen = 200): string {
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
}

function resolveSiteOrigin(config: ReturnType<typeof useRuntimeConfig>): string {
  const configured = String(config.public.siteUrl || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  const event = useRequestEvent();
  if (event) return getRequestURL(event).origin;
  return 'http://localhost';
}

function toAbsoluteUrl(origin: string, url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${origin}${path}`;
}

/** Sync composable — do not mark async or await fetches here (breaks prerender). */
export function usePageSeo(options: MaybeRefOrGetter<PageSeoInput> = {}) {
  const config = useRuntimeConfig();
  const route = useRoute();
  const { siteSettings } = useSiteSettings();

  const origin = resolveSiteOrigin(config);
  const input = computed(() => toValue(options));

  const pageTitle = computed(() => {
    const custom = input.value.title?.trim();
    if (custom) return custom;
    return siteSettings.value.siteName;
  });

  const documentTitle = computed(() => {
    const custom = input.value.title?.trim();
    if (!custom) return siteSettings.value.siteName;
    return `${custom} | ${siteSettings.value.siteName}`;
  });

  const pageDescription = computed(() => {
    const custom = input.value.description?.trim();
    if (custom) return stripForMeta(custom);
    return stripForMeta(siteSettings.value.siteDescription);
  });

  const ogImage = computed(() => {
    const custom = input.value.image;
    const fallback = siteSettings.value.logoUrl || '/icons/pwa-512.png';
    const raw = custom || fallback;
    const sized = custom ? (sizeUrl(raw, 'large') ?? raw) : raw;
    return toAbsoluteUrl(origin, sized);
  });

  const canonicalUrl = computed(() => {
    const path = route.path || '/';
    return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  });

  useHead({
    title: documentTitle,
    link: computed(() => [{ rel: 'canonical', href: canonicalUrl.value }]),
    meta: computed(() => {
      const tags: Array<{ name: string; content: string }> = [];
      if (input.value.noIndex) {
        tags.push({ name: 'robots', content: 'noindex, nofollow' });
      }
      return tags;
    }),
  });

  useSeoMeta({
    description: pageDescription,
    ogTitle: pageTitle,
    ogDescription: pageDescription,
    ogType: computed(() => input.value.ogType ?? 'website'),
    ogUrl: canonicalUrl,
    ogImage: ogImage,
    ogSiteName: computed(() => siteSettings.value.siteName),
    twitterCard: 'summary_large_image',
    twitterTitle: pageTitle,
    twitterDescription: pageDescription,
    twitterImage: ogImage,
  });
}
