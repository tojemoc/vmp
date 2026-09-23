/**
 * Ad insertion gate for the web player / layout.
 * When ads_enabled is off (default), nothing is shown.
 * Club + staff skip ads even when the global flag is on.
 * Lapsed subscriptions do not count as club for ad-free.
 */

import { shouldShowAds } from '@vmp/shared';

function activePlanType(
  subscription: {
    planType?: string;
    status?: string;
    currentPeriodEnd?: string | null;
  } | null,
): string | undefined {
  if (!subscription) return undefined;
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return undefined;
  if (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) <= new Date()) {
    return undefined;
  }
  return subscription.planType;
}

export function useAdPolicy() {
  const { siteSettings } = useSiteSettings();
  const { subscription, user } = useAuth();

  const showAds = computed(() =>
    shouldShowAds({
      adsEnabled: siteSettings.value.adsEnabled,
      planType: activePlanType(subscription.value),
      role: user.value?.role,
    }),
  );

  return {
    showAds,
    adsEnabled: computed(() => siteSettings.value.adsEnabled),
  };
}
