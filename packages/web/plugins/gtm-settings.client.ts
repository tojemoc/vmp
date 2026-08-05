/**
 * Loads GTM from public site settings when enabled in Admin → System.
 * Container ID and optional Cloudflare Google Tag Gateway path are runtime-only (D1).
 */
import { getGtmScriptUrl } from '~/utils/gtm';

export default defineNuxtPlugin(async () => {
  const router = useRouter();
  const { siteSettings, fetchSiteSettings } = useSiteSettings();

  function loadGtm(containerId: string, measurementPath?: string | null) {
    const id = containerId.trim();
    if (!id || typeof window === 'undefined') return;
    if ((window as any).google_tag_manager?.[id]) return;

    (window as any).dataLayer = (window as any).dataLayer || [];
    (window as any).dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const script = document.createElement('script');
    script.async = true;
    script.src = getGtmScriptUrl(id, measurementPath);
    document.head.appendChild(script);
  }

  function pushContentView(to: { fullPath: string; name?: string | symbol | null }) {
    const w = window as Window & { dataLayer?: Array<Record<string, unknown>> };
    w.dataLayer = w.dataLayer ?? [];
    const base = String(router.options.history?.base ?? '').replace(/\/+$/, '');
    const fullPath = to.fullPath.startsWith('/') ? to.fullPath : `/${to.fullPath}`;
    const queryHashIdx = fullPath.search(/[?#]/);
    const pathOnly = queryHashIdx >= 0 ? fullPath.slice(0, queryHashIdx) : fullPath;
    const queryAndHash = queryHashIdx >= 0 ? fullPath.slice(queryHashIdx) : '';
    const path = `${base}${pathOnly}`.replace(/\/{2,}/g, '/') + queryAndHash;
    const viewName = typeof to.name === 'string' && to.name ? to.name : path;
    w.dataLayer.push({
      event: 'content-view',
      'content-name': path,
      'content-view-name': viewName,
    });
  }

  function installRouterSync() {
    pushContentView(router.currentRoute.value);
    router.afterEach((to) => pushContentView(to));
  }

  await fetchSiteSettings();
  if (!siteSettings.value.gtmEnabled) return;

  const containerId = String(siteSettings.value.gtmContainerId ?? '').trim();
  if (!containerId) return;

  const measurementPath = String(siteSettings.value.gtmMeasurementPath ?? '').trim() || null;
  loadGtm(containerId, measurementPath);
  installRouterSync();
});
