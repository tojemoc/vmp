<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm font-medium border"
          :class="mobileOrderMode ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'"
          @click="toggleMobileOrderMode"
        >
          Mobile order
        </button>
        <p v-if="mobileOrderMode" class="text-xs text-gray-500 dark:text-gray-400">Reorder blocks for viewports under 1024px. Hidden blocks are dimmed.</p>
      </div>
      <button type="button" class="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg" @click="addBlock('top_video')">
        <span class="text-lg leading-none">+</span> Add block
      </button>
    </div>

    <p v-if="!mobileOrderMode" class="text-xs text-gray-500 dark:text-gray-400">
      Use <strong class="font-medium">Half width</strong> for side-by-side rows. Two half blocks on the same row pair automatically — left is the main category (2×2), right is the side-mini column.
    </p>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      <template v-for="slot in editorSlots" :key="slot.key">
        <div
          v-if="slot.kind === 'drop'"
          class="min-h-[4rem] rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-100/50 dark:bg-gray-900/50 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 lg:col-span-1"
          :class="dragOverId === slot.key ? 'ring-2 ring-blue-400 border-blue-400' : ''"
          @dragover.prevent="onDragOver(slot.key, $event)"
          @dragleave="dragOverId = null"
          @drop="onDropPartnerSlot(slot.anchorBlockId)"
        >
          Drop here for right column
        </div>

        <div
          v-else
          class="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950"
          :class="[
            blockColSpan(slot.block),
            dragOverId === slot.block.id ? 'ring-2 ring-blue-400' : '',
            mobileOrderMode && slot.block.mobileHidden === true ? 'opacity-40' : '',
          ]"
          :draggable="!mobileOrderMode"
          @dragstart="onDragStart(slot.block.id)"
          @dragover.prevent="onDragOver(slot.block.id, $event)"
          @dragleave="dragOverId = null"
          @drop="onDrop(slot.block.id)"
        >
          <div class="flex items-center gap-3 mb-3 flex-wrap">
            <span v-if="!mobileOrderMode" class="cursor-move text-gray-500 dark:text-gray-400" title="Drag to reorder">⠿</span>
            <span v-else class="cursor-move text-gray-500 dark:text-gray-400" :draggable="true" @dragstart.stop="onDragStart(slot.block.id)" @dragover.prevent @drop.stop="onDrop(slot.block.id)">☰</span>
            <span class="text-xs font-mono text-gray-500 dark:text-gray-400">{{ positionLabel(slot.block) }}</span>
            <select
              v-model="slot.block.type"
              aria-label="Homepage block type"
              class="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
              @change="onTypeChange(slot.block)"
            >
              <option v-for="t in blockTypeOptions(slot.block.type)" :key="t" :value="t">{{ t }}</option>
            </select>
            <select
              v-if="!mobileOrderMode && slot.block.type !== 'split_horizontal' && slot.block.type !== 'split_vertical'"
              v-model="slot.block.width"
              class="px-2 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-white"
              @change="onWidthChange(slot.block)"
            >
              <option value="full">Full width</option>
              <option value="half">Half width</option>
            </select>
            <p
              v-if="!mobileOrderMode && blockWouldExpand(slot.block)"
              class="text-xs text-amber-700 dark:text-amber-300"
            >
              Row partner empty — renders full width on homepage.
            </p>
            <button type="button" class="ml-auto text-sm text-red-600 dark:text-red-400 hover:underline" @click="removeBlock(slot.block.id)">Remove</button>
          </div>

          <label v-if="mobileOrderMode" class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-3">
            <input
              :checked="slot.block.mobileHidden !== true"
              type="checkbox"
              class="rounded border-gray-300 dark:border-gray-600"
              @change="setMobileVisible(slot.block.id, ($event.target as HTMLInputElement).checked)"
            >
            Show on mobile
          </label>

          <div class="grid gap-3">
            <input v-model="slot.block.title" type="text" placeholder="Block title" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            <textarea v-model="slot.block.body" rows="3" placeholder="Block copy" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            <select
              v-if="slot.block.type === 'category'"
              v-model="slot.block.categoryId"
              class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
            >
              <option value="">Select category</option>
              <option v-for="cat in categories" :key="`block-cat-${slot.block.id}-${cat.id}`" :value="cat.id">{{ cat.name }}</option>
            </select>
            <div v-if="(slot.block.type === 'split_horizontal' || slot.block.type === 'split_vertical') && slot.block.childBlocks" class="grid gap-3 rounded-md border border-dashed border-gray-300 dark:border-gray-700 p-3">
              <div v-for="(child, childIndex) in slot.block.childBlocks" :key="`${slot.block.id}-child-${childIndex}`" class="grid gap-2 rounded border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-900">
                <div class="text-xs font-semibold text-gray-600 dark:text-gray-400">Child block {{ childIndex + 1 }}</div>
                <select v-model="child.type" class="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white">
                  <option v-for="t in leafBlockTypeOptions(child.type)" :key="t" :value="t">{{ t }}</option>
                </select>
                <input v-model="child.title" type="text" placeholder="Child block title" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <textarea v-model="child.body" rows="2" placeholder="Child block copy" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                <select v-if="child.type === 'category'" v-model="child.categoryId" class="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white">
                  <option value="">Select category</option>
                  <option v-for="cat in categories" :key="`child-cat-${slot.block.id}-${childIndex}-${cat.id}`" :value="cat.id">{{ cat.name }}</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  assignGridPositions,
  ensureBlockGridPositions,
  orderBlocksByGrid,
  orderLayoutBlocksForViewport,
  rowPartnerBlock,
  type HomepageLayoutBlock,
} from '~/composables/useHomepageLayout'

type BlockType = HomepageLayoutBlock['type']
type LeafBlockType = 'featured_row' | 'category' | 'top_video'

interface CategoryOption {
  id: string
  name: string
  video_count?: number
  homepage_layout_variant?: 'three_by_one' | 'side_mini'
}

type EditorSlot =
  | { kind: 'block'; key: string; block: HomepageLayoutBlock }
  | { kind: 'drop'; key: string; anchorBlockId: string; gridRow: number }

const blocks = defineModel<HomepageLayoutBlock[]>({ required: true })

const props = defineProps<{
  categories: CategoryOption[]
}>()

const mobileOrderMode = ref(false)
const draggingId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)
const dropBeforeId = ref<string | null>(null)

/** Return live block references in grid/mobile order — never shallow copies from ensureBlockGridPositions. */
const sortedBlocks = computed(() => {
  const order = mobileOrderMode.value
    ? orderLayoutBlocksForViewport(blocks.value, true)
    : orderBlocksByGrid(blocks.value)
  const byId = new Map(blocks.value.map((block) => [block.id, block]))
  return order.map((block) => byId.get(block.id) ?? block)
})

const editorSlots = computed((): EditorSlot[] => {
  if (mobileOrderMode.value) {
    return sortedBlocks.value.map((block) => ({
      kind: 'block' as const,
      key: block.id,
      block,
    }))
  }

  const positioned = orderBlocksByGrid(blocks.value)
  const byId = new Map(blocks.value.map((block) => [block.id, block]))
  const rows = new Map<number, HomepageLayoutBlock[]>()
  for (const block of positioned) {
    const row = Number(block.gridRow)
    if (!rows.has(row)) rows.set(row, [])
    rows.get(row)!.push(block)
  }

  const slots: EditorSlot[] = []
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const rowBlocks = (rows.get(row) ?? []).sort((a, b) => Number(a.gridCol) - Number(b.gridCol))
    const fullBlock = rowBlocks.find((block) => block.width === 'full')
    if (fullBlock) {
      const live = byId.get(fullBlock.id) ?? fullBlock
      slots.push({ kind: 'block', key: live.id, block: live })
      continue
    }

    const col0 = rowBlocks.find((block) => Number(block.gridCol) === 0)
    const col1 = rowBlocks.find((block) => Number(block.gridCol) === 1)

    if (col0) {
      const live = byId.get(col0.id) ?? col0
      slots.push({ kind: 'block', key: live.id, block: live })
    }
    if (col1) {
      const live = byId.get(col1.id) ?? col1
      slots.push({ kind: 'block', key: live.id, block: live })
    } else if (col0?.width === 'half') {
      slots.push({
        kind: 'drop',
        key: `drop-${row}-1`,
        anchorBlockId: col0.id,
        gridRow: row,
      })
    }
  }
  return slots
})

function syncGridPositions() {
  blocks.value = assignGridPositions([...blocks.value])
}

function syncMobileOrderFromGrid() {
  const ordered = orderBlocksByGrid(blocks.value)
  blocks.value = ordered.map((block, index) => {
    const live = blocks.value.find((entry) => entry.id === block.id) ?? block
    return { ...live, mobileOrder: index }
  })
}

function toggleMobileOrderMode() {
  if (!mobileOrderMode.value) {
    syncMobileOrderFromGrid()
  }
  mobileOrderMode.value = !mobileOrderMode.value
}

function defaultWidth(type: BlockType): 'full' | 'half' {
  if (type === 'featured_row' || type === 'top_video') return 'full'
  return 'half'
}

function blockColSpan(block: HomepageLayoutBlock): string {
  if (mobileOrderMode.value) return 'lg:col-span-2'
  return block.width === 'full' ? 'lg:col-span-2' : 'lg:col-span-1'
}

function positionLabel(block: HomepageLayoutBlock): string {
  if (mobileOrderMode.value) {
    const order = Number.isFinite(Number(block.mobileOrder)) ? Number(block.mobileOrder) : 0
    return `mobile #${order + 1}`
  }
  const positioned = ensureBlockGridPositions([block])[0]
  return `row ${Number(positioned?.gridRow ?? 0)}, col ${Number(positioned?.gridCol ?? 0)}`
}

function setMobileVisible(blockId: string, visible: boolean) {
  blocks.value = blocks.value.map((block) =>
    block.id === blockId ? { ...block, mobileHidden: !visible } : block,
  )
}

function categoryHasVideos(categoryId: string | null | undefined): boolean {
  if (!categoryId) return false
  const cat = props.categories.find((entry) => entry.id === categoryId)
  return Number(cat?.video_count ?? 0) > 0
}

function partnerHasRenderableContent(block: HomepageLayoutBlock): boolean {
  const partner = rowPartnerBlock(blocks.value, block)
  if (!partner) return false
  if (partner.type !== 'category') return true
  return categoryHasVideos(partner.categoryId)
}

function blockWouldExpand(block: HomepageLayoutBlock): boolean {
  if (block.width !== 'half') return false
  if (block.type === 'category' && !categoryHasVideos(block.categoryId)) return false
  return !partnerHasRenderableContent(block)
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
  syncGridPositions()
}

function onWidthChange(block: HomepageLayoutBlock) {
  const live = blocks.value.find((entry) => entry.id === block.id)
  if (live) live.width = block.width
  syncGridPositions()
}

function addBlock(type: BlockType = 'top_video') {
  const id = crypto.randomUUID()
  blocks.value = assignGridPositions([
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
      ...(type === 'split_horizontal' || type === 'split_vertical'
        ? {
          childBlocks: [
            { type: 'top_video' as LeafBlockType, title: '', body: '', categoryId: '' },
            { type: 'top_video' as LeafBlockType, title: '', body: '', categoryId: '' },
          ],
        }
        : {}),
    },
  ])
}

function removeBlock(id: string) {
  blocks.value = assignGridPositions(blocks.value.filter((b) => b.id !== id))
}

function onDragStart(id: string) {
  draggingId.value = id
}

function onDragOver(id: string, event: DragEvent) {
  dragOverId.value = id
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const mid = rect.top + rect.height / 2
  dropBeforeId.value = event.clientY < mid ? id : null
}

function reorderBlocks(fromId: string, targetId: string, insertAfterTarget = false) {
  const ordered = mobileOrderMode.value
    ? orderLayoutBlocksForViewport(blocks.value, true)
    : orderBlocksByGrid(blocks.value)
  const fromIndex = ordered.findIndex((block) => block.id === fromId)
  let targetIndex = ordered.findIndex((block) => block.id === targetId)
  if (fromIndex < 0 || targetIndex < 0) return null

  if (!insertAfterTarget) {
    if (dropBeforeId.value !== targetId && fromIndex < targetIndex) targetIndex += 1
  } else {
    targetIndex += 1
    if (fromIndex < targetIndex) targetIndex -= 1
  }

  const reordered = ordered.map((block) => blocks.value.find((entry) => entry.id === block.id) ?? block)
  const [moved] = reordered.splice(fromIndex, 1)
  if (!moved) return null
  if (!insertAfterTarget && fromIndex < targetIndex) targetIndex -= 1
  reordered.splice(targetIndex, 0, moved)
  return reordered
}

function onDrop(targetId: string) {
  const fromId = draggingId.value
  if (!fromId || fromId === targetId) return
  const reordered = reorderBlocks(fromId, targetId)
  if (!reordered) return

  if (mobileOrderMode.value) {
    blocks.value = reordered.map((block, index) => ({ ...block, mobileOrder: index }))
  } else {
    blocks.value = assignGridPositions(reordered)
  }
  draggingId.value = null
  dragOverId.value = null
  dropBeforeId.value = null
}

function onDropPartnerSlot(anchorBlockId: string) {
  const fromId = draggingId.value
  if (!fromId || fromId === anchorBlockId) return
  const reordered = reorderBlocks(fromId, anchorBlockId, true)
  if (!reordered) return

  const moved = reordered.find((block) => block.id === fromId)
  if (moved && moved.type !== 'split_horizontal' && moved.type !== 'split_vertical') {
    moved.width = 'half'
  }
  blocks.value = assignGridPositions(reordered)
  draggingId.value = null
  dragOverId.value = null
  dropBeforeId.value = null
}

watch(blocks, (list) => {
  for (const block of list) {
    if (!block.width) block.width = defaultWidth(block.type)
    if (block.mobileHidden == null) block.mobileHidden = false
  }
}, { deep: true, immediate: true })

onMounted(() => {
  syncGridPositions()
})
</script>
