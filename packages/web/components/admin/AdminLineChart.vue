<template>
  <div class="w-full">
    <svg
      :viewBox="`0 0 ${width} ${height}`"
      class="w-full h-auto"
      role="img"
      :aria-label="ariaLabel"
      preserveAspectRatio="none"
    >
      <line
        v-for="(tick, index) in yTicks"
        :key="`grid-${index}`"
        :x1="padding.left"
        :y1="tick.y"
        :x2="width - padding.right"
        :y2="tick.y"
        class="stroke-gray-200 dark:stroke-gray-800"
        stroke-width="1"
      />
      <text
        v-for="(tick, index) in yTicks"
        :key="`ylabel-${index}`"
        :x="padding.left - 6"
        :y="tick.y"
        text-anchor="end"
        dominant-baseline="middle"
        class="fill-gray-500 dark:fill-gray-400 text-[10px]"
      >
        {{ tick.label }}
      </text>
      <polyline
        v-if="points.length > 1"
        fill="none"
        :points="polylinePoints"
        :class="strokeClass"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle
        v-for="(point, index) in points"
        :key="`pt-${index}`"
        :cx="point.x"
        :cy="point.y"
        r="3"
        :class="strokeClass"
        fill="currentColor"
      />
    </svg>
    <div class="relative mt-2 h-4 text-[10px] text-gray-500 dark:text-gray-400">
      <span
        v-for="(item, index) in xLabelPositions"
        :key="`xl-${index}`"
        class="absolute max-w-[33%] truncate"
        :style="{
          left: `${item.leftPercent}%`,
          transform: item.anchor === 'start' ? 'none' : item.anchor === 'end' ? 'translateX(-100%)' : 'translateX(-50%)',
        }"
      >{{ item.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
export type AdminLineChartPoint = {
  label: string
  value: number
}

const props = withDefaults(defineProps<{
  points: AdminLineChartPoint[]
  ariaLabel?: string
  strokeClass?: string
  height?: number
}>(), {
  ariaLabel: 'Line chart',
  strokeClass: 'stroke-blue-500 text-blue-500',
  height: 160,
})

const width = 640
const height = computed(() => props.height)
const padding = { top: 12, right: 12, bottom: 8, left: 44 }

const values = computed(() => props.points.map((p) => Math.max(0, Number(p.value) || 0)))
const maxValue = computed(() => Math.max(1, ...values.value, 0))

const chartPoints = computed(() => {
  const count = props.points.length
  if (count === 0) return []
  const innerW = width - padding.left - padding.right
  const innerH = height.value - padding.top - padding.bottom
  return props.points.map((point, index) => {
    const x = count === 1
      ? padding.left + innerW / 2
      : padding.left + (index / (count - 1)) * innerW
    const y = padding.top + innerH - (Math.max(0, point.value) / maxValue.value) * innerH
    return { x, y, label: point.label, value: point.value }
  })
})

const points = chartPoints
const polylinePoints = computed(() => chartPoints.value.map((p) => `${p.x},${p.y}`).join(' '))

const yTicks = computed(() => {
  const innerH = height.value - padding.top - padding.bottom
  return [0, 0.5, 1].map((ratio) => ({
    y: padding.top + innerH * (1 - ratio),
    label: Math.round(maxValue.value * ratio),
  }))
})

function xToPercent(x: number): number {
  return (x / width) * 100
}

const xLabelPositions = computed(() => {
  const pts = chartPoints.value
  if (pts.length === 0) return []

  const toPosition = (index: number) => {
    const point = pts[index]
    const anchor = index === 0 ? 'start' : index === pts.length - 1 ? 'end' : 'center'
    return {
      label: point?.label ?? '',
      leftPercent: xToPercent(point?.x ?? padding.left),
      anchor: anchor as 'start' | 'center' | 'end',
    }
  }

  if (pts.length <= 4) {
    return pts.map((_, index) => toPosition(index))
  }

  const picks = [0, Math.floor(pts.length / 2), pts.length - 1]
  return [...new Set(picks)].map((index) => toPosition(index))
})
</script>
