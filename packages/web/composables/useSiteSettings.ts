/**
 * Singleton composable that fetches public site branding settings once and
 * provides them reactively to the header, page title, and anywhere else.
 */

import strings from '~/utils/strings';

interface SiteSettings {
  siteName: string;
  siteNameShort: string;
  siteDescription: string;
  logoUrl: string;
  faviconUrl: string;
  /** Empty when `site_support_email` is not configured in admin settings. */
  supportEmail: string;
  gtmEnabled: boolean;
  gtmContainerId: string;
  gtmMeasurementPath: string;
}

function defaultSiteSettings(): SiteSettings {
  return {
    siteName: strings.siteName,
    siteNameShort: strings.siteNameShort,
    siteDescription: strings.siteDescription,
    logoUrl: '',
    faviconUrl: '',
    supportEmail: '',
    gtmEnabled: false,
    gtmContainerId: '',
    gtmMeasurementPath: '',
  };
}

function mapSiteSettings(data: Record<string, unknown> | null | undefined): SiteSettings {
  if (!data) return defaultSiteSettings();
  return {
    siteName: String(data.site_name || strings.siteName),
    siteNameShort: String(data.site_name_short || strings.siteNameShort),
    siteDescription: String(data.site_description || strings.siteDescription),
    logoUrl: String(data.site_logo_url || ''),
    faviconUrl: String(data.site_favicon_url || ''),
    supportEmail: String(data.site_support_email || '').trim(),
    gtmEnabled: String(data.gtm_enabled ?? '0') === '1',
    gtmContainerId: String(data.gtm_container_id || ''),
    gtmMeasurementPath: String(data.gtm_measurement_path || ''),
  };
}

export function useSiteSettings() {
  const config = useRuntimeConfig();

  const { data, refresh } = useAsyncData('site-settings', async () => {
    try {
      const res = await fetch(`${config.public.apiUrl}/api/site-settings`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  });

  const siteSettings = computed(() => mapSiteSettings(data.value));

  /** @deprecated Prefer relying on useAsyncData; kept for callers that explicitly refresh. */
  async function fetchSiteSettings() {
    await refresh();
  }

  return {
    siteSettings: readonly(siteSettings),
    fetchSiteSettings,
  };
}
