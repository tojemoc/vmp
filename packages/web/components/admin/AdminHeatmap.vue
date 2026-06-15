<template>
  <div class="w-full">
    <div
      class="flex h-16 w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950"
      role="img"
      :aria-label="ariaLabel"
    >
      <div
        v-for="bucket in normalizedBuckets"
        :key="`hm-${bucket.positionPercent}`"
        class="h-full flex-1 min-w-0"
        :title="`${bucket.positionPercent}% · ${bucket.watchSeconds}s watched`"
        :style="{ backgroundColor: bucket.color }"
      />
    </div>
    <div class="mt-2 flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
      <span>0%</span>
      <span>50%</span>
      <span>100%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
export type AdminHeatmapBucket = {
  positionPercent: number
  watchSeconds: number
}

const props = withDefaults(defineProps<{
  buckets: AdminHeatmapBucket[]
  ariaLabel?: string
}>(), {
  ariaLabel: 'Video engagement heatmap',
})

function heatColor(intensity: number) {
  const alpha = Math.max(0.12, Math.min(1, intensity))
  return `rgba(16, 185, 129, ${alpha})`
}

const normalizedBuckets = computed(() => {
  const buckets = props.buckets ?? []
  const max = buckets.reduce((peak, bucket) => Math.max(peak, Number(bucket.watchSeconds) || 0), 0)
  const safeMax = max > 0 ? max : 1
  return buckets.map((bucket) => {
    const watchSeconds = Number(bucket.watchSeconds) || 0
    return {
      positionPercent: bucket.positionPercent,
      watchSeconds,
      color: heatColor(watchSeconds / safeMax),
    }
  })
})
</script>
