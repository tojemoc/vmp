<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm font-medium border"
          :class="mobileOrderMode ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'"
          @click="mobileOrderMode = !mobileOrderMode"
        >
          Mobile order
        </button>
        <p v-if="mobileOrderMode" class="text-xs text-gray-500 dark:text-gray-400">Reorder blocks for viewports under 1024px.</p>
      </div>
      <button type="button" class="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg" @click="addBlock('top_video')">
        <span class="text-lg leading-none">+</span> Add block
      </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      <template v-for="(block, index) in blocks" :key="block.id">
        <div
          v-if="dropIndicatorIndex === index"
          class="col-span-1 lg:col-span-2 h-1 bg-blue-500 rounded-full"
          aria-hidden="true"
        />
        <div
          class="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950"
          :class="[blockColSpan(block), dragOverIndex === index ? 'ring-2 ring-blue-400' : '']"
          :draggable="!mobileOrderMode"
          @dragstart="onDragStart(index)"
          @dragover.prevent="onDragOver(index, $event)"
          @dragleave="dragOverIndex = null"
          @drop="onDrop(index)"
        >
          <div class="flex items-center gap-3 mb-3">
            <span v-if="!mobileOrderMode" class="cursor-move text-gray-500" title="Drag to reorder">⠿</span>
            <span v-else class="cursor-move text-gray-500" :draggable="true" @dragstart.stop="onDragStart(index)" @dragover.prevent @drop.stop="onDrop(index)">☰</span>
            <select
              v-model="block.type"
              aria-label="Homepage block type"
              class="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
              @change="onTypeChange(block)"
            >
              <option v-for="t in blockTypeOptions(block.type)" :key="t" :value="t">{{ t }}</option>
            </select>
            <select
              v-if="!mobileOrderMode && block.type !== 'split_horizontal' && block.type !== 'split_vertical'"
              v-model="block.width"
              class="px-2 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-white"
            >
              <option value="full">Full width</option>
              <option value="half">Half width</option>
            </select>
            <button type="button" class="ml-auto text-sm text-red-600 hover:underline" @click="removeBlock(block.id)">Remove</button>
          </div>

          <label v-if="mobileOrderMode" class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-3">
            <input :checked="block.mobileHidden !== true" type="checkbox" class="rounded border-gray-300 dark:border-gray-600" @change="block.mobileHidden = !($event.target as HTMLInputElement).checked">
            Show on mobile
          </label>

          <div class="grid gap-3">
            <input v-model="block.title" type="text" placeholder="Block title" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            <textarea v-model="block.body" rows="3" placeholder="Block copy" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            <select
              v-if="block.type === 'category'"
              v-model="block.categoryId"
              class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
            >
              <option value="">Select category</option>
              <option v-for="cat in categories" :key="`block-cat-${block.id}-${cat.id}`" :value="cat.id">{{ cat.name }}</option>
            </select>
            <label v-if="block.type === 'category'" class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input v-model="block.rightRailWithNextSideMini" type="checkbox" class="rounded border-gray-300 dark:border-gray-600">
              Pair next side-mini category on right (2×2 + 2×1)
            </label>
            <p
              v-if="block.type === 'category' && block.rightRailWithNextSideMini && !nextBlockIsSideMini(index)"
              class="text-xs text-amber-700 dark:text-amber-300 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2 py-1"
            >
              The next block is not a side-mini category — pairing will not apply on the public homepage.
            </p>
            <div v-if="(block.type === 'split_horizontal' || block.type === 'split_vertical') && block.childBlocks" class="grid gap-3 rounded-md border border-dashed border-gray-300 dark:border-gray-700 p-3">
              <div v-for="(child, childIndex) in block.childBlocks" :key="`${block.id}-child-${childIndex}`" class="grid gap-2 rounded border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-900">
                <div class="text-xs font-semibold text-gray-600 dark:text-gray-400">Child block {{ childIndex + 1 }}</div>
                <select v-model="child.type" class="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white">
                  <option v-for="t in leafBlockTypeOptions(child.type)" :key="t" :value="t">{{ t }}</option>
                </select>
                <input v-model="child.title" type="text" placeholder="Child block title" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <textarea v-model="child.body" rows="2" placeholder="Child block copy" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <select v-if="child.type === 'category'" v-model="child.categoryId" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white">
                  <option value="">Select category</option>
                  <option v-for="cat in categories" :key="`child-cat-${block.id}-${childIndex}-${cat.id}`" :value="cat.id">{{ cat.name }}</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div
        v-if="dropIndicatorIndex === blocks.length"
        class="col-span-1 lg:col-span-2 h-1 bg-blue-500 rounded-full"
        aria-hidden="true"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HomepageLayoutBlock } from '~/composables/useHomepageLayout'

type BlockType = HomepageLayoutBlock['type']
type LeafBlockType = 'featured_row' | 'category' | 'top_video'

interface CategoryOption {
  id: string
  name: string
  homepage_layout_variant?: 'three_by_one' | 'side_mini'
}

const blocks = defineModel<HomepageLayoutBlock[]>({ required: true })

const props = defineProps<{
  categories: CategoryOption[]
}>()

const mobileOrderMode = ref(false)
const draggingIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
const dropIndicatorIndex = ref<number | null>(null)

function defaultWidth(type: BlockType): 'full' | 'half' {
  if (type === 'featured_row' || type === 'top_video') return 'full'
  return 'half'
}

function blockColSpan(block: HomepageLayoutBlock): string {
  return block.width === 'full' ? 'lg:col-span-2' : 'lg:col-span-1'
}

function blockTypeOptions(current: BlockType): BlockType[] {
  const all: BlockType[] = ['featured_row', 'category', 'top_video', 'split_horizontal', 'split_vertical']
  return all.includes(current) ? all : [...all, current]
}

function leafBlockTypeOptions(current: LeafBlockType): LeafBlockType[] {
  const all: LeafBlockType[] = ['featured_row', 'category', 'top_video']
  return all.includes(current) ? all : [...all, current]
}

function onTypeChange(block: HomepageLayoutBlock) {
  if (!block.width) block.width = defaultWidth(block.type)
}

function nextBlockIsSideMini(index: number): boolean {
  const next = blocks.value[index + 1]
  if (!next || next.type !== 'category' || !next.categoryId) return false
  const c = props.categories.find((cat) => cat.id === next.categoryId)
  return c?.homepage_layout_variant === 'side_mini'
}

function addBlock(type: BlockType = 'top_video') {
  const id = crypto.randomUUID()
  blocks.value = [
    ...blocks.value,
    {
      id,
      type,
      title: '',
      body: '',
      categoryId: type === 'category' ? '' : null,
      width: defaultWidth(type),
      mobileHidden: false,
      mobileOrder: blocks.value.length,
      rightRailWithNextSideMini: false,
      ...(type === 'split_horizontal' || type === 'split_vertical'
        ? {
          childBlocks: [
            { type: 'top_video' as LeafBlockType, title: '', body: '', categoryId: '' },
            { type: 'top_video' as LeafBlockType, title: '', body: '', categoryId: '' },
          ],
        }
        : {}),
    },
  ]
}

function removeBlock(id: string) {
  blocks.value = blocks.value.filter((b) => b.id !== id)
}

function onDragStart(index: number) {
  draggingIndex.value = index
}

function onDragOver(index: number, event: DragEvent) {
  dragOverIndex.value = index
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const mid = rect.top + rect.height / 2
  dropIndicatorIndex.value = event.clientY < mid ? index : index + 1
}

function onDrop(targetIndex: number) {
  const from = draggingIndex.value
  if (from === null) return
  let insertAt = dropIndicatorIndex.value ?? targetIndex
  if (insertAt > from) insertAt -= 1
  const reordered = [...blocks.value]
  const [moved] = reordered.splice(from, 1)
  if (!moved) return
  reordered.splice(insertAt, 0, moved)
  if (mobileOrderMode.value) {
    reordered.forEach((b, i) => { b.mobileOrder = i })
  } else {
    blocks.value = reordered
  }
  draggingIndex.value = null
  dragOverIndex.value = null
  dropIndicatorIndex.value = null
}

watch(blocks, (list) => {
  for (const block of list) {
    if (!block.width) block.width = defaultWidth(block.type)
    if (block.mobileHidden == null) block.mobileHidden = false
  }
}, { deep: true, immediate: true })
</script>
