import type {
  CmsBlock,
  CmsCalloutVariant,
  CmsRichTextDocument,
} from '@vmp/shared'

const CALLOUT_VARIANTS = new Set<CmsCalloutVariant>(['info', 'warning', 'error'])

const ALLOWED_BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
])

const ALLOWED_MARKS = new Set(['bold', 'italic', 'strike', 'code', 'underline', 'link'])

const MAX_NODE_DEPTH = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validateMark(mark: unknown): boolean {
  if (!isRecord(mark) || typeof mark.type !== 'string' || !ALLOWED_MARKS.has(mark.type)) return false
  if (mark.type === 'link') {
    return isRecord(mark.attrs) && typeof mark.attrs.href === 'string'
  }
  return true
}

function validateTipTapNode(node: unknown, depth = 0): boolean {
  if (depth > MAX_NODE_DEPTH) return false
  if (!isRecord(node) || typeof node.type !== 'string') return false

  if (node.type === 'text') {
    if (typeof node.text !== 'string') return false
    if (node.marks === undefined) return true
    return Array.isArray(node.marks) && node.marks.every((mark) => validateMark(mark))
  }

  if (!ALLOWED_BLOCK_NODES.has(node.type)) return false

  if (node.type === 'heading') {
    if (!isRecord(node.attrs) || typeof node.attrs.level !== 'number') return false
    if (![2, 3, 4].includes(node.attrs.level)) return false
  }

  if (node.content === undefined) return true
  if (!Array.isArray(node.content)) return false
  return node.content.every((child) => validateTipTapNode(child, depth + 1))
}

function isRichTextDocument(value: unknown): value is CmsRichTextDocument {
  if (!isRecord(value) || value.type !== 'doc' || !Array.isArray(value.content)) return false
  return value.content.every((node) => validateTipTapNode(node))
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

function validateTableInvariants(
  columns: string[],
  columnKeys: string[],
  rows: Array<Record<string, string>>,
): boolean {
  if (columns.length !== columnKeys.length) return false
  const normalizedKeys = columnKeys.map((key) => key.trim())
  if (normalizedKeys.some((key) => !key)) return false
  if (new Set(normalizedKeys).size !== normalizedKeys.length) return false
  return rows.every((row) => normalizedKeys.every((key) => typeof row[key] === 'string'))
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
      if (!validateTableInvariants(raw.columns, raw.columnKeys, raw.rows)) return null
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
