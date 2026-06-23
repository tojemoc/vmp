import type {
  CmsBlock,
  CmsCalloutVariant,
  CmsRichTextDocument,
} from '@vmp/shared'

const CALLOUT_VARIANTS = new Set<CmsCalloutVariant>(['info', 'warning', 'error'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isRichTextDocument(value: unknown): value is CmsRichTextDocument {
  return isRecord(value) && value.type === 'doc' && Array.isArray(value.content)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

export function parseCmsBlock(raw: unknown): CmsBlock | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null

  switch (raw.type) {
    case 'rich_text':
      return isRichTextDocument(raw.content)
        ? { type: 'rich_text', content: raw.content }
        : null
    case 'image': {
      if (typeof raw.imageId !== 'string' || !raw.imageId.trim()) return null
      const block = { type: 'image' as const, imageId: raw.imageId.trim() }
      if (raw.caption === undefined) return block
      return typeof raw.caption === 'string'
        ? { ...block, caption: raw.caption }
        : null
    }
    case 'callout':
      return CALLOUT_VARIANTS.has(raw.variant as CmsCalloutVariant) && isRichTextDocument(raw.content)
        ? { type: 'callout', variant: raw.variant as CmsCalloutVariant, content: raw.content }
        : null
    case 'divider':
      return { type: 'divider' }
    case 'table': {
      if (!Array.isArray(raw.columns) || !Array.isArray(raw.columnKeys) || !Array.isArray(raw.rows)) return null
      if (!raw.columns.every((column) => typeof column === 'string')) return null
      if (!raw.columnKeys.every((key) => typeof key === 'string')) return null
      if (!raw.rows.every((row) => isStringRecord(row))) return null
      return {
        type: 'table',
        columns: raw.columns,
        columnKeys: raw.columnKeys,
        rows: raw.rows,
      }
    }
    default:
      return null
  }
}

export function parseCmsBlocks(raw: unknown): CmsBlock[] | null {
  if (!Array.isArray(raw)) return null
  const blocks: CmsBlock[] = []
  for (const item of raw) {
    const block = parseCmsBlock(item)
    if (!block) return null
    blocks.push(block)
  }
  return blocks
}
