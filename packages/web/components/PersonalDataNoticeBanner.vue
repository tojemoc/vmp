<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="opacity-0 -translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 -translate-y-2"
  >
    <div
      v-if="showBanner"
      class="bg-slate-800 text-slate-100 border-b border-slate-700 px-4 py-3"
      role="region"
      aria-label="Personal data notice"
    >
      <div class="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p class="text-sm leading-relaxed text-slate-200">
          {{ strings.personalDataBannerSummary }}
          {{ ' ' }}
          <NuxtLink
            to="/personal-data"
            class="font-semibold text-white underline underline-offset-2 hover:text-blue-200"
            @click="onLearnMore"
          >
            {{ strings.personalDataLearnMore }}
          </NuxtLink>
        </p>
        <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button
            type="button"
            class="px-3 py-1.5 text-xs font-semibold bg-white text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
            @click="onAcknowledge"
          >
            {{ strings.personalDataBannerAcknowledge }}
          </button>
          <button
            type="button"
            class="p-1.5 rounded-md hover:bg-slate-700 transition-colors"
            :aria-label="strings.dismiss"
            @click="onAcknowledge"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import strings from '~/utils/strings'

const { showBanner, acknowledgeNotice } = usePersonalDataNotice()

function onAcknowledge() {
  acknowledgeNotice()
}

function onLearnMore() {
  acknowledgeNotice()
}
</script>
