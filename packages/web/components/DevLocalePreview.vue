<template>
  <div
    class="fixed bottom-3 left-3 z-[9999] flex flex-col gap-2 max-w-xs rounded-lg border border-amber-500/50 bg-amber-950/95 text-amber-50 shadow-lg backdrop-blur px-3 py-2 text-xs"
    role="region"
    aria-label="Locale preview (development only)"
  >
    <p class="font-semibold leading-snug">
      Locale preview
      <span v-if="isDevLocalePreview" class="text-amber-300">(override)</span>
    </p>
    <p class="text-amber-200/90 leading-relaxed">
      Review SK/CZ copy in real UI flows. Edit <code class="text-amber-100">locales/{{ locale }}/</code> — HMR updates strings.
    </p>
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="code in locales"
        :key="code"
        type="button"
        class="px-2 py-1 rounded border transition-colors"
        :class="
          locale === code
            ? 'border-amber-300 bg-amber-800 text-white'
            : 'border-amber-700/80 hover:border-amber-500 hover:bg-amber-900'
        "
        @click="selectLocale(code)"
      >
        {{ code.toUpperCase() }}
      </button>
      <button
        v-if="isDevLocalePreview"
        type="button"
        class="px-2 py-1 rounded border border-amber-700/80 hover:border-amber-500 hover:bg-amber-900"
        @click="clearDevUiLocalePreview()"
      >
        Reset
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SUPPORTED_UI_LOCALES } from '~/locales'
import type { UiLocale } from '~/locales'
import { clearDevUiLocalePreview, setDevUiLocalePreview } from '~/utils/resolveUiLocale'

const locales = SUPPORTED_UI_LOCALES
const { locale, isDevLocalePreview } = useUiLocale()

function selectLocale(code: UiLocale) {
  if (locale.value === code) return
  setDevUiLocalePreview(code)
}
</script>
