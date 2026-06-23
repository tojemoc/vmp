import type { CmsBlock, CmsPageInput } from '@vmp/shared'
import { requireAuth, requireRole } from './auth.js'
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

function parsePageInput(body: unknown): CmsPageInput | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as Record<string, unknown>
  if (typeof raw.title !== 'string' || typeof raw.slug !== 'string') return null
  if (!Array.isArray(raw.content)) return null
  return {
    title: raw.title.trim(),
    slug: raw.slug.trim(),
    description: typeof raw.description === 'string' ? raw.description.trim() : null,
    status: raw.status === 'published' ? 'published' : 'draft',
    content: raw.content as CmsBlock[],
  }
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
  if (!page) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
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
    const actorId = await getActorId(request, env)
    const page = await repo(env).updatePage(id, input, actorId)
    if (!page) return jsonResponse({ error: 'Page not found' }, 404, corsHeaders)
    return jsonResponse({ page }, 200, corsHeaders)
  }

  if (request.method === 'DELETE') {
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

  const existing = await repo(env).getPageBySlug(input.slug)
  if (existing) return jsonResponse({ error: 'Slug already in use', code: 'SLUG_EXISTS' }, 409, corsHeaders)

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

  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > 10 * 1024 * 1024) return jsonResponse({ error: 'Image too large (max 10MB)' }, 413, corsHeaders)

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
