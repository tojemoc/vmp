<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="opacity-0 -translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-2"
  >
    <!--
      One banner only. When PostHog is configured, analytics consent replaces the
      old personal-data “Rozumiem” notice. Without PostHog, keep the informational notice.
    -->
    <div
      v-if="showBanner"
      class="bg-slate-800 dark:bg-slate-900 text-slate-100 dark:text-slate-100 border-b border-slate-700 dark:border-slate-600 px-4 py-3"
      role="region"
      :aria-label="
        showAnalyticsBanner ? strings.posthogAnalyticsConsentTitle : strings.personalDataPageTitle
      "
    >
      <div class="max-w-7xl mx-auto">
        <div
          v-if="showAnalyticsBanner"
          class="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <p class="text-sm leading-relaxed text-slate-200 dark:text-slate-300">
            {{ strings.posthogAnalyticsConsentSummary }}
            {{ ' ' }}
            <!-- Native <a>: full navigation — NuxtLink client nav to CMS /personal-data can render blank. -->
            <a
              href="/personal-data"
              class="font-semibold text-white dark:text-white underline underline-offset-2 hover:text-blue-200 dark:hover:text-blue-300"
            >
              {{ strings.posthogAnalyticsConsentLearnMore }}
            </a>
          </p>
          <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <!-- Identical styles on purpose — no accept/decline visual hierarchy (dark pattern). -->
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-100 dark:text-slate-100 bg-transparent dark:bg-transparent border border-slate-400 dark:border-slate-400 rounded-md hover:bg-slate-700 dark:hover:bg-slate-700 transition-colors"
              @click="onGrantAnalytics"
            >
              <span aria-hidden="true">✓</span>
              {{ strings.posthogAnalyticsConsentAccept }}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-100 dark:text-slate-100 bg-transparent dark:bg-transparent border border-slate-400 dark:border-slate-400 rounded-md hover:bg-slate-700 dark:hover:bg-slate-700 transition-colors"
              @click="onDenyAnalytics"
            >
              <span aria-hidden="true">✕</span>
              {{ strings.posthogAnalyticsConsentDecline }}
            </button>
          </div>
        </div>

        <div
          v-else
          class="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <p class="text-sm leading-relaxed text-slate-200 dark:text-slate-300">
            {{ strings.personalDataBannerSummary }}
            {{ ' ' }}
            <a
              href="/personal-data"
              class="font-semibold text-white dark:text-white underline underline-offset-2 hover:text-blue-200 dark:hover:text-blue-300"
              @click="onAcknowledge"
            >
              {{ strings.personalDataLearnMore }}
            </a>
          </p>
          <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <button
              type="button"
              class="px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-900 bg-white dark:bg-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-200 transition-colors"
              @click="onAcknowledge"
            >
              {{ strings.personalDataBannerAcknowledge }}
            </button>
            <button
              type="button"
              class="p-1.5 rounded-md text-slate-200 dark:text-slate-200 hover:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
              :aria-label="strings.dismiss"
              @click="onAcknowledge"
            >
              <svg
                class="w-4 h-4 text-slate-200 dark:text-slate-200"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
  import strings from '~/utils/strings';

  const config = useRuntimeConfig();
  const posthogEnabled = Boolean(String(config.public.posthog?.publicKey ?? '').trim());

  const { showBanner: showPersonalDataBanner, acknowledgeNotice } = usePersonalDataNotice();
  const {
    showAnalyticsConsentPrompt,
    grantAnalyticsConsent,
    denyAnalyticsConsent,
  } = usePostHogConsent();

  /** Analytics consent replaces the informational notice when PostHog is configured. */
  const showAnalyticsBanner = computed(
    () => posthogEnabled && showAnalyticsConsentPrompt.value,
  );

  const showBanner = computed(() =>
    posthogEnabled ? showAnalyticsBanner.value : showPersonalDataBanner.value,
  );

  function onAcknowledge() {
    acknowledgeNotice();
  }

  function decideAnalytics(grant: boolean): void {
    if (grant) grantAnalyticsConsent();
    else denyAnalyticsConsent();
    // Retire the old notice key so it never reappears alongside analytics consent.
    acknowledgeNotice();
  }

  function onGrantAnalytics() {
    decideAnalytics(true);
  }

  function onDenyAnalytics() {
    decideAnalytics(false);
  }
</script>
