import type { CmsPageInput, CmsPageStatus } from '@vmp/shared'
import { isCmsSystemPageId, isCmsSystemSlug } from '@vmp/shared'
import { requireAuth, requireRole } from './auth.js'
import { parseCmsBlocks } from './cmsBlockValidation.js'
import { CmsPagesRepository } from './cmsPagesRepository.js'

type Env = {
  DB?: CmsPagesRepository extends { db: infer D } ? D : unknown
  video_subscription_db?: unknown
  BUCKET?: { put(key: string, body: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown> }
  R2_BASE_URL?: string
}

function getDb(env: Env) {
  return (env.DB || env.video_subscription_db) as ConstructorParameters<typeof CmsPagesRepository>[0]
}

function repo(env: Env) {
  return new CmsPagesRepository(getDb(env))
}

function jsonResponse(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function parsePageStatus(raw: unknown): CmsPageStatus | undefined | null {
  if (raw === undefined) return undefined
  if (raw === 'published' || raw === 'draft') return raw
  return null
}

function parsePageInput(body: unknown): CmsPageInput | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as Record<string, unknown>
  if (typeof raw.title !== 'string' || typeof raw.slug !== 'string') return null
  const content = parseCmsBlocks(raw.content)
  if (!content) return null
  const slug = raw.slug.trim()
  if (!slug) return null
  const status = parsePageStatus(raw.status)
  if (status === null) return null
  const input: CmsPageInput = {
    title: raw.title.trim(),
    slug,
    description: typeof raw.description === 'string' ? raw.description.trim() : null,
    content,
  }
  if (status !== undefined) input.status = status
  return input
}

async function isSlugTaken(env: Env, slug: string, excludePageId?: string): Promise<boolean> {
  const existing = await repo(env).getPageBySlug(slug)
  return !!existing && existing.id !== excludePageId
}

async function requireAdmin(request: Request, env: Env) {
  await requireRole(request, env, 'admin', 'super_admin')
}

async function getActorId(request: Request, env: Env): Promise<string | null> {
  try {
    const payload = await requireAuth(request, env) as { sub?: string; userId?: string }
    return payload.sub ?? payload.userId ?? null
  } catch {
    return null
  }
}

export async function handleCmsPagesList(request: Request, env: Env, corsHeaders: Record<string, string>) {
  try {
    await requireAdmin(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const pages = await repo(env).listPages()
  return jsonResponse({ pages }, 200, corsHeaders)
}

export async function handleCmsPageBySlug(request: Request, env: Env, corsHeaders: Record<string, string>, slug: string) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)

  const url = new URL(request.url)
  const preview = url.searchParams.get('preview') === '1'

  if (preview) {
    try {
      await requireAdmin(request, env)
    } catch {
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }
    const page = await repo(env).getPageBySlug(slug, { publishedOnly: false })
    if (!page) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
    return jsonResponse({ page }, 200, corsHeaders)
  }

  const page = await repo(env).getPageBySlug(slug, { publishedOnly: true })
  if (!page || isCmsSystemSlug(slug)) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
  return jsonResponse({ page }, 200, corsHeaders)
}

export async function handleCmsPageById(request: Request, env: Env, corsHeaders: Record<string, string>, id: string) {
  try {
    await requireAdmin(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  if (request.method === 'GET') {
    const page = await repo(env).getPageById(id)
    if (!page) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
    return jsonResponse({ page }, 200, corsHeaders)
  }

  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null)
    const input = parsePageInput(body)
    if (!input) return jsonResponse({ error: 'Invalid page payload' }, 400, corsHeaders)
    const existing = await repo(env).getPageById(id)
    if (!existing) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
    if (isCmsSystemPageId(id)) {
      input.slug = existing.slug
    } else if (isCmsSystemSlug(input.slug)) {
      return jsonResponse({ error: 'Slug is reserved for system pages', code: 'SLUG_RESERVED' }, 409, corsHeaders)
    }
    const slugConflict = await isSlugTaken(env, input.slug, id)
    if (slugConflict) {
      return jsonResponse({ error: 'Slug already in use', code: 'SLUG_EXISTS' }, 409, corsHeaders)
    }
    const actorId = await getActorId(request, env)
    const page = await repo(env).updatePage(id, input, actorId)
    if (!page) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
    return jsonResponse({ page }, 200, corsHeaders)
  }

  if (request.method === 'DELETE') {
    if (isCmsSystemPageId(id)) {
      return jsonResponse({ error: 'System pages cannot be deleted', code: 'SYSTEM_PAGE' }, 403, corsHeaders)
    }
    const ok = await repo(env).deletePage(id)
    if (!ok) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
    return jsonResponse({ ok: true }, 200, corsHeaders)
  }

  return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
}

export async function handleCmsPageCreate(request: Request, env: Env, corsHeaders: Record<string, string>) {
  try {
    await requireAdmin(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)

  const body = await request.json().catch(() => null)
  const input = parsePageInput(body)
  if (!input) return jsonResponse({ error: 'Invalid page payload' }, 400, corsHeaders)

  if (isCmsSystemSlug(input.slug)) {
    return jsonResponse({ error: 'Slug is reserved for system pages', code: 'SLUG_RESERVED' }, 409, corsHeaders)
  }
  if (await isSlugTaken(env, input.slug)) {
    return jsonResponse({ error: 'Slug already in use', code: 'SLUG_EXISTS' }, 409, corsHeaders)
  }

  const actorId = await getActorId(request, env)
  const page = await repo(env).createPage(input, actorId)
  return jsonResponse({ page }, 201, corsHeaders)
}

export async function handleCmsPagePublish(request: Request, env: Env, corsHeaders: Record<string, string>, id: string) {
  try {
    await requireAdmin(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const actorId = await getActorId(request, env)
  const page = await repo(env).publishPage(id, actorId)
  if (!page) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
  return jsonResponse({ page }, 200, corsHeaders)
}

export async function handleCmsPageUnpublish(request: Request, env: Env, corsHeaders: Record<string, string>, id: string) {
  try {
    await requireAdmin(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const actorId = await getActorId(request, env)
  const page = await repo(env).unpublishPage(id, actorId)
  if (!page) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
  return jsonResponse({ page }, 200, corsHeaders)
}

export async function handleCmsPageRevisions(request: Request, env: Env, corsHeaders: Record<string, string>, id: string) {
  try {
    await requireAdmin(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const revisions = await repo(env).listRevisions(id)
  return jsonResponse({ revisions }, 200, corsHeaders)
}

export async function handleCmsPageRestoreRevision(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
  id: string,
  revisionId: string,
) {
  try {
    await requireAdmin(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const actorId = await getActorId(request, env)
  const page = await repo(env).restoreRevision(id, revisionId, actorId)
  if (!page) return jsonResponse({ error: 'Revision not found' }, 404, corsHeaders)
  return jsonResponse({ page }, 200, corsHeaders)
}

export async function handleCmsMediaUpload(request: Request, env: Env, corsHeaders: Record<string, string>) {
  try {
    await requireAdmin(request, env)
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  if (!env.BUCKET) return jsonResponse({ error: 'R2 bucket not configured' }, 503, corsHeaders)

  const form = await request.formData().catch(() => null)
  const file = form?.get('image')
  if (!file || typeof file === 'string') return jsonResponse({ error: 'Missing image file' }, 400, corsHeaders)
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    return jsonResponse({ error: 'Unsupported image type' }, 415, corsHeaders)
  }
  if (file.size > 10 * 1024 * 1024) {
    return jsonResponse({ error: 'Image too large (max 10MB)' }, 413, corsHeaders)
  }

  const bytes = await file.arrayBuffer()

  const ext = file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
      : file.type === 'image/gif' ? 'gif'
        : 'jpg'

  const base = String(env.R2_BASE_URL ?? '').trim().replace(/\/$/, '')
  if (!base) return jsonResponse({ error: 'R2_BASE_URL is not configured' }, 503, corsHeaders)

  const key = `cms/${Date.now()}-${crypto.randomUUID()}.${ext}`
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: file.type } })

  let width: number | null = null
  let height: number | null = null
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }))
    width = bitmap.width
    height = bitmap.height
    bitmap.close()
  } catch {
    // dimensions optional
  }

  const actorId = await getActorId(request, env)
  const media = await repo(env).createMedia({
    key,
    filename: file.name || `image.${ext}`,
    width,
    height,
    contentType: file.type,
    createdBy: actorId,
  })

  return jsonResponse({
    media: {
      ...media,
      url: `${base}/${key}`,
    },
  }, 201, corsHeaders)
}

export async function handleCmsMediaById(request: Request, env: Env, corsHeaders: Record<string, string>, id: string) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const base = String(env.R2_BASE_URL ?? '').trim()
  const media = await repo(env).getMediaById(id, base)
  if (!media) return jsonResponse({ error: 'Media not found' }, 404, corsHeaders)
  return jsonResponse({ media }, 200, corsHeaders)
}

export async function handleCmsMediaBatch(request: Request, env: Env, corsHeaders: Record<string, string>) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const url = new URL(request.url)
  const rawIds = String(url.searchParams.get('ids') ?? '').trim()
  if (!rawIds) return jsonResponse({ media: [] }, 200, corsHeaders)
  const ids = rawIds.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 50)
  const base = String(env.R2_BASE_URL ?? '').trim()
  const media = await repo(env).getMediaByIds(ids, base)
  return jsonResponse({ media }, 200, corsHeaders)
}
