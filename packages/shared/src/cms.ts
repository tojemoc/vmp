/** TipTap / Lexical-compatible JSON document root (stored as-is, never HTML). */
export type CmsRichTextDocument = Record<string, unknown>

export type CmsRichTextBlock = {
  type: 'rich_text'
  content: CmsRichTextDocument
}

export type CmsImageBlock = {
  type: 'image'
  imageId: string
  caption?: string
}

export type CmsCalloutVariant = 'info' | 'warning' | 'error'

export type CmsCalloutBlock = {
  type: 'callout'
  variant: CmsCalloutVariant
  content: CmsRichTextDocument
}

export type CmsDividerBlock = {
  type: 'divider'
}

/** Tabular data block (e.g. cookie/storage tables). */
export type CmsTableBlock = {
  type: 'table'
  columns: string[]
  rows: Array<Record<string, string>>
  /** Keys matching `columns` order for each row object. */
  columnKeys: string[]
}

export type CmsBlock =
  | CmsRichTextBlock
  | CmsImageBlock
  | CmsCalloutBlock
  | CmsDividerBlock
  | CmsTableBlock

export type CmsPageStatus = 'draft' | 'published'

export type CmsPage = {
  id: string
  title: string
  slug: string
  description: string | null
  status: CmsPageStatus
  content: CmsBlock[]
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export type CmsPageRevision = {
  id: string
  pageId: string
  title: string
  slug: string
  description: string | null
  status: CmsPageStatus
  content: CmsBlock[]
  createdAt: string
  createdBy: string | null
}

export type CmsMedia = {
  id: string
  key: string
  filename: string
  width: number | null
  height: number | null
  contentType: string | null
  url?: string
  createdAt: string
  createdBy: string | null
}

export type CmsPageInput = {
  title: string
  slug: string
  description?: string | null
  status?: CmsPageStatus
  content: CmsBlock[]
}
