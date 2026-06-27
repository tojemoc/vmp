import type { CmsBlock, CmsMedia, CmsPage, CmsPageInput, CmsPageRevision } from '@vmp/shared'

export type CmsDbStatement = {
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
  bind(...args: unknown[]): CmsDbStatement
}

export type CmsDb = {
  prepare(query: string): CmsDbStatement
  batch?(statements: unknown[]): Promise<unknown>
}

export type CmsPageRow = {
  id: string
  title: string
  slug: string
  description: string | null
  status: string
  content: string
  created_at: string
  updated_at: string
  published_at: string | null
}

export type CmsRevisionRow = {
  id: string
  page_id: string
  title: string
  slug: string
  description: string | null
  status: string
  content: string
  created_at: string
  created_by: string | null
}

export type CmsMediaRow = {
  id: string
  key: string
  filename: string
  width: number | null
  height: number | null
  content_type: string | null
  created_at: string
  created_by: string | null
}

export function parseCmsBlocks(raw: string): CmsBlock[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? (parsed as CmsBlock[]) : []
  } catch {
    return []
  }
}

export function serializeCmsBlocks(blocks: CmsBlock[]): string {
  return JSON.stringify(blocks ?? [])
}

export function mapPageRow(row: CmsPageRow): CmsPage {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    status: row.status as CmsPage['status'],
    content: parseCmsBlocks(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  }
}

export function mapRevisionRow(row: CmsRevisionRow): CmsPageRevision {
  return {
    id: row.id,
    pageId: row.page_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    status: row.status as CmsPageRevision['status'],
    content: parseCmsBlocks(row.content),
    createdAt: row.created_at,
    createdBy: row.created_by,
  }
}

export function mapMediaRow(row: CmsMediaRow, baseUrl = ''): CmsMedia {
  const normalizedBase = baseUrl.replace(/\/$/, '')
  const media: CmsMedia = {
    id: row.id,
    key: row.key,
    filename: row.filename,
    width: row.width,
    height: row.height,
    contentType: row.content_type,
    createdAt: row.created_at,
    createdBy: row.created_by,
  }
  if (normalizedBase) {
    media.url = `${normalizedBase}/${row.key}`
  }
  return media
}

export function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
  return slug || 'untitled'
}

export class CmsPagesRepository {
  constructor(private readonly db: CmsDb) {}

  async listPages(options: { publishedOnly?: boolean } = {}): Promise<CmsPage[]> {
    const query = options.publishedOnly
      ? `SELECT * FROM cms_pages WHERE status = 'published' ORDER BY title COLLATE NOCASE ASC`
      : `SELECT * FROM cms_pages ORDER BY updated_at DESC`
    const { results } = await this.db.prepare(query).all<CmsPageRow>()
    return results.map(mapPageRow)
  }

  async getPageById(id: string): Promise<CmsPage | null> {
    const row = await this.db.prepare(`SELECT * FROM cms_pages WHERE id = ?`).bind(id).first<CmsPageRow>()
    return row ? mapPageRow(row) : null
  }

  async getPageBySlug(slug: string, options: { publishedOnly?: boolean } = {}): Promise<CmsPage | null> {
    const query = options.publishedOnly
      ? `SELECT * FROM cms_pages WHERE slug = ? AND status = 'published'`
      : `SELECT * FROM cms_pages WHERE slug = ?`
    const row = await this.db.prepare(query).bind(slug).first<CmsPageRow>()
    return row ? mapPageRow(row) : null
  }

  async createPage(input: CmsPageInput, actorId: string | null): Promise<CmsPage> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const status = input.status ?? 'draft'
    const publishedAt = status === 'published' ? now : null
    const content = serializeCmsBlocks(input.content)
    await this.db.prepare(
      `INSERT INTO cms_pages (id, title, slug, description, status, content, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.title, input.slug, input.description ?? null, status, content, now, now, publishedAt).run()

    const page = await this.getPageById(id)
    if (!page) throw new Error('Failed to create page')
    await this.createRevision(page, actorId)
    return page
  }

  async updatePage(id: string, input: Partial<CmsPageInput>, actorId: string | null): Promise<CmsPage | null> {
    const existing = await this.getPageById(id)
    if (!existing) return null

    const title = input.title ?? existing.title
    const slug = input.slug ?? existing.slug
    const description = input.description !== undefined ? input.description : existing.description
    const status = input.status ?? existing.status
    const content = input.content ?? existing.content
    const now = new Date().toISOString()
    const publishedAt = status === 'published'
      ? (existing.publishedAt ?? now)
      : null

    await this.db.prepare(
      `UPDATE cms_pages
       SET title = ?, slug = ?, description = ?, status = ?, content = ?, updated_at = ?, published_at = ?
       WHERE id = ?`,
    ).bind(title, slug, description, status, serializeCmsBlocks(content), now, publishedAt, id).run()

    const page = await this.getPageById(id)
    if (page) await this.createRevision(page, actorId)
    return page
  }

  async deletePage(id: string): Promise<boolean> {
    const result = await this.db.prepare(`DELETE FROM cms_pages WHERE id = ?`).bind(id).run() as { meta?: { changes?: number } }
    return (result?.meta?.changes ?? 0) > 0
  }

  async publishPage(id: string, actorId: string | null): Promise<CmsPage | null> {
    return this.updatePage(id, { status: 'published' }, actorId)
  }

  async unpublishPage(id: string, actorId: string | null): Promise<CmsPage | null> {
    return this.updatePage(id, { status: 'draft' }, actorId)
  }

  async listRevisions(pageId: string): Promise<CmsPageRevision[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM cms_page_revisions WHERE page_id = ? ORDER BY created_at DESC`)
      .bind(pageId)
      .all<CmsRevisionRow>()
    return results.map(mapRevisionRow)
  }

  async getRevision(pageId: string, revisionId: string): Promise<CmsPageRevision | null> {
    const row = await this.db
      .prepare(`SELECT * FROM cms_page_revisions WHERE page_id = ? AND id = ?`)
      .bind(pageId, revisionId)
      .first<CmsRevisionRow>()
    return row ? mapRevisionRow(row) : null
  }

  async restoreRevision(pageId: string, revisionId: string, actorId: string | null): Promise<CmsPage | null> {
    const revision = await this.getRevision(pageId, revisionId)
    if (!revision) return null
    return this.updatePage(pageId, {
      title: revision.title,
      slug: revision.slug,
      description: revision.description,
      status: revision.status,
      content: revision.content,
    }, actorId)
  }

  private async createRevision(page: CmsPage, actorId: string | null): Promise<void> {
    const id = crypto.randomUUID()
    await this.db.prepare(
      `INSERT INTO cms_page_revisions (id, page_id, title, slug, description, status, content, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      page.id,
      page.title,
      page.slug,
      page.description,
      page.status,
      serializeCmsBlocks(page.content),
      new Date().toISOString(),
      actorId,
    ).run()
  }

  async createMedia(input: {
    key: string
    filename: string
    width?: number | null
    height?: number | null
    contentType?: string | null
    createdBy?: string | null
  }): Promise<CmsMedia> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await this.db.prepare(
      `INSERT INTO cms_media (id, key, filename, width, height, content_type, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      input.key,
      input.filename,
      input.width ?? null,
      input.height ?? null,
      input.contentType ?? null,
      now,
      input.createdBy ?? null,
    ).run()

    const row = await this.db.prepare(`SELECT * FROM cms_media WHERE id = ?`).bind(id).first<CmsMediaRow>()
    if (!row) throw new Error('Failed to create media record')
    return mapMediaRow(row)
  }

  async getMediaById(id: string, baseUrl = ''): Promise<CmsMedia | null> {
    const row = await this.db.prepare(`SELECT * FROM cms_media WHERE id = ?`).bind(id).first<CmsMediaRow>()
    return row ? mapMediaRow(row, baseUrl) : null
  }

  async getMediaByIds(ids: string[], baseUrl = ''): Promise<CmsMedia[]> {
    const unique = [...new Set(ids.filter(Boolean))]
    if (unique.length === 0) return []
    const placeholders = unique.map(() => '?').join(', ')
    const rows = await this.db
      .prepare(`SELECT * FROM cms_media WHERE id IN (${placeholders})`)
      .bind(...unique)
      .all<CmsMediaRow>()
    return (rows.results ?? []).map((row) => mapMediaRow(row, baseUrl))
  }
}
