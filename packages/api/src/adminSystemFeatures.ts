import { requireRole } from './auth.js'
import { getSetting, setSettings } from './settingsStore.js'

function jsonResponse(data: any, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function toBoolSetting(value: unknown, fallback: boolean) {
  if (value == null) return fallback
  return String(value).trim() === '1'
}

export async function handleAdminSystemFeatures(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  if (request.method === 'GET') {
    const [promotionsEnabled, isicEnabled, freePodcastPreviewEnabled] = await Promise.all([
      getSetting(env, 'promotions_enabled', { defaultValue: '1' }),
      getSetting(env, 'isic_api_enabled', { defaultValue: '0' }),
      getSetting(env, 'rss_free_preview_enabled', { defaultValue: '1' }),
    ])
    return jsonResponse({
      promotionsEnabled: toBoolSetting(promotionsEnabled, true),
      isicEnabled: toBoolSetting(isicEnabled, false),
      freePodcastPreviewEnabled: toBoolSetting(freePodcastPreviewEnabled, true),
    }, 200, corsHeaders)
  }

  if (request.method !== 'PATCH') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Request body is required' }, 400, corsHeaders)
  }

  const updates: [string, string][] = []
  if (Object.prototype.hasOwnProperty.call(body, 'promotionsEnabled')) {
    updates.push(['promotions_enabled', body.promotionsEnabled === true ? '1' : '0'])
  }
  if (Object.prototype.hasOwnProperty.call(body, 'isicEnabled')) {
    updates.push(['isic_api_enabled', body.isicEnabled === true ? '1' : '0'])
  }
  if (Object.prototype.hasOwnProperty.call(body, 'freePodcastPreviewEnabled')) {
    updates.push(['rss_free_preview_enabled', body.freePodcastPreviewEnabled === true ? '1' : '0'])
  }
  if (!updates.length) {
    return jsonResponse({ error: 'No fields to update' }, 400, corsHeaders)
  }

  await setSettings(env, updates)
  return jsonResponse({ ok: true }, 200, corsHeaders)
}
