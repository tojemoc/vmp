<template>
  <div
    v-if="show"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm"
  >
    <div class="relative bg-gray-900 rounded-xl p-8 max-w-lg w-full mx-4 text-center shadow-2xl">
      <button
        type="button"
        :aria-label="strings.premiumOverlayClose"
        class="absolute top-3 right-3 inline-flex items-center justify-center w-8 h-8 rounded-full text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
        @click="emit('close')"
      >
        <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
        </svg>
      </button>

      <SubscriptionCheckoutPanel
        :return-path="watchReturnPath"
        reopen-premium-on-return
        :active="show"
        :embedded="false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import strings from '~/utils/strings'

const props = defineProps<{
  show: boolean
  videoId: string
}>()
const emit = defineEmits<{ close: [] }>()

const watchReturnPath = computed(() => `/watch/${encodeURIComponent(props.videoId)}`)
</script>
