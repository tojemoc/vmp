/**
 * Site-wide branding settings: name, description, logo URL, favicon URL.
 *
 * These are stored in admin_settings under keys prefixed with `site_`.
 * GET is public (unauthenticated) so the frontend can read them at boot.
 * PATCH requires admin or super_admin.
 */

import { requireRole } from './auth.js'
import { getSetting, setSettings } from './settingsStore.js'

function jsonResponse(body: any, status = 200, corsHeaders: any = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

const SITE_KEYS = [
  'site_name',
  'site_name_short',
  'site_description',
  'site_logo_url',
  'site_favicon_url',
  'podcast_title',
  'podcast_description',
] as const

export async function handleSiteSettings(request: any, env: any, corsHeaders: any) {
  if (request.method === 'GET') {
    const entries = await Promise.all(
      SITE_KEYS.map(async (key) => [key, await getSetting(env, key, { defaultValue: '' })])
    )
    return jsonResponse(Object.fromEntries(entries), 200, corsHeaders)
  }

  if (request.method === 'PATCH') {
    try {
      await requireRole(request, env, 'admin', 'super_admin')
    } catch {
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400, corsHeaders)
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return jsonResponse({ error: 'Request body must be a JSON object', code: 'INVALID_BODY' }, 400, corsHeaders)
    }

    const updates: [string, string][] = []
    for (const key of SITE_KEYS) {
      if (key in body && typeof body[key] === 'string') {
        updates.push([key, body[key]])
      }
    }

    if (updates.length === 0) {
      return jsonResponse({ error: 'No valid fields to update' }, 400, corsHeaders)
    }

    await setSettings(env, updates)
    return jsonResponse({ ok: true, updated: updates.map(([k]) => k) }, 200, corsHeaders)
  }

  return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
}