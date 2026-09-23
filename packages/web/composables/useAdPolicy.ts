/**
 * Ad insertion gate for the web player / layout.
 * When ads_enabled is off (default), nothing is shown.
 * Club + staff skip ads even when the global flag is on.
 */

import { shouldShowAds } from '@vmp/shared';

export function useAdPolicy() {
  const { siteSettings } = useSiteSettings();
  const { subscription, user } = useAuth();

  const showAds = computed(() =>
    shouldShowAds({
      adsEnabled: siteSettings.value.adsEnabled,
      planType: subscription.value?.planType,
      role: user.value?.role,
    }),
  );

  return {
    showAds,
    adsEnabled: computed(() => siteSettings.value.adsEnabled),
  };
}
