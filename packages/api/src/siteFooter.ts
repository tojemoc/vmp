/**
 * Site footer: CMS content from the system footer page + configurable nav links to other CMS pages.
 */

import type { CmsBlock, CmsPage } from '@vmp/shared'
import { CMS_FOOTER_PAGE_ID, CMS_FOOTER_SLUG } from '@vmp/shared'
import { requireRole } from './auth.js'
import { getSetting, setSetting } from './settingsStore.js'
import { CmsPagesRepository } from './cmsPagesRepository.js'
import { ensureAdminSettingsTable } from './adminSettingsTable.js'

const SITE_FOOTER_KEY = 'site_footer'

type SiteFooterConfig = {
  linkPageIds: string[]
}

type FooterLink = {
  id: string
  title: string
  slug: string
}

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

function jsonResponse(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function normalizeFooterConfig(raw: unknown): SiteFooterConfig {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const linkPageIds = Array.isArray(input.linkPageIds)
    ? input.linkPageIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  return { linkPageIds }
}

async function loadFooterPage(env: any): Promise<CmsPage | null> {
  const repo = new CmsPagesRepository(getDb(env))
  return repo.getPageById(CMS_FOOTER_PAGE_ID)
}

async function resolveFooterLinks(env: any, linkPageIds: string[]): Promise<FooterLink[]> {
  if (!linkPageIds.length) return []
  const repo = new CmsPagesRepository(getDb(env))
  const links: FooterLink[] = []
  for (const pageId of linkPageIds) {
    if (pageId === CMS_FOOTER_PAGE_ID) continue
    const page = await repo.getPageById(pageId)
    if (!page || page.status !== 'published') continue
    links.push({ id: page.id, title: page.title, slug: page.slug })
  }
  return links
}

export async function handleSiteFooterPublic(request: Request, env: any, corsHeaders: Record<string, string>) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }
  try {
    const db = getDb(env)
    await ensureAdminSettingsTable(db)
    const [footerPage, configRaw] = await Promise.all([
      loadFooterPage(env),
      getSetting(env, SITE_FOOTER_KEY, { defaultValue: '{"linkPageIds":[]}' }),
    ])
    const config = normalizeFooterConfig(safeJsonParse(configRaw, {}))
    const links = await resolveFooterLinks(env, config.linkPageIds)
    const content: CmsBlock[] = footerPage?.content ?? []
    return jsonResponse({ content, links }, 200, corsHeaders)
  } catch (error) {
    console.error('handleSiteFooterPublic:', error)
    return jsonResponse({ error: 'Internal server error', code: 'internal_error' }, 500, corsHeaders)
  }
}

export async function handleSiteFooterAdmin(request: Request, env: any, corsHeaders: Record<string, string>) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const db = getDb(env)
  await ensureAdminSettingsTable(db)

  if (request.method === 'GET') {
    const [footerPage, configRaw] = await Promise.all([
      loadFooterPage(env),
      getSetting(env, SITE_FOOTER_KEY, { defaultValue: '{"linkPageIds":[]}' }),
    ])
    const config = normalizeFooterConfig(safeJsonParse(configRaw, {}))
    return jsonResponse({
      footerPage,
      linkPageIds: config.linkPageIds,
    }, 200, corsHeaders)
  }

  if (request.method === 'PATCH') {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400, corsHeaders)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse({ error: 'Request body must be a JSON object', code: 'INVALID_BODY' }, 400, corsHeaders)
    }
    const raw = body as Record<string, unknown>
    if (!Array.isArray(raw.linkPageIds)) {
      return jsonResponse({ error: 'linkPageIds must be an array', code: 'INVALID_LINKS' }, 400, corsHeaders)
    }

    const repo = new CmsPagesRepository(db)
    const linkPageIds: string[] = []
    for (const id of raw.linkPageIds) {
      if (typeof id !== 'string' || !id.trim()) continue
      const trimmed = id.trim()
      if (trimmed === CMS_FOOTER_PAGE_ID) continue
      const page = await repo.getPageById(trimmed)
      if (!page || page.slug === CMS_FOOTER_SLUG) continue
      linkPageIds.push(page.id)
    }

    const config: SiteFooterConfig = { linkPageIds }
    await setSetting(env, SITE_FOOTER_KEY, JSON.stringify(config))
    const links = await resolveFooterLinks(env, linkPageIds)
    return jsonResponse({ ok: true, linkPageIds, links }, 200, corsHeaders)
  }

  return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
}
