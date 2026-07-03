/**
 * POST /api/admin/videos/:id/pipeline-status
 * Signed callback from media-pipeline (Encore orchestrator) when HLS renditions become available.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { log } from './logger.js'

interface PipelineEnv {
  DB?: D1Database
  video_subscription_db?: D1Database
  VMP_API_PIPELINE_SECRET?: string
  RATE_LIMIT_KV?: { delete: (key: string) => Promise<void> }
}

function jsonResponse(data: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifyPipelineWebhook(rawBody: string, sigHeader: string, tsHeader: string, secret: string) {
  if (!secret || !sigHeader || !tsHeader) return false
  const tsNum = Number(tsHeader)
  if (!Number.isFinite(tsNum) || tsNum <= 0) return false
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - tsNum) > 5 * 60) return false

  const m = sigHeader.match(/^sha256=([0-9a-f]{64})$/i)
  const provided = m?.[1]
  if (!provided) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${tsHeader}.${rawBody}`))
  const expected = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  return constantTimeEqual(provided.toLowerCase(), expected.toLowerCase())
}

function getDb(env: PipelineEnv) {
  const db = env.DB || env.video_subscription_db
  if (!db) throw new Error('D1 binding not found')
  return db
}

export async function handleVideoPipelineStatus(request: Request, env: PipelineEnv, corsHeaders: Record<string, string>, videoId: string) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  const secret = String(env.VMP_API_PIPELINE_SECRET ?? '').trim()
  if (!secret) {
    return jsonResponse({ error: 'Pipeline webhook secret is not configured', code: 'secret_not_configured' }, 503, corsHeaders)
  }

  const rawBody = await request.text()
  const sigHeader = request.headers.get('X-VMP-Signature') ?? ''
  const tsHeader = request.headers.get('X-VMP-Timestamp') ?? ''
  const valid = await verifyPipelineWebhook(rawBody, sigHeader, tsHeader, secret)
  if (!valid) {
    log({ service: 'pipeline', event: 'pipeline_webhook_invalid_signature', level: 'warn', video_id: videoId })
    return jsonResponse({ error: 'Invalid signature', code: 'invalid_signature' }, 401, corsHeaders)
  }

  let payload: {
    event?: string
    videoId?: string
    stage?: string
    hlsManifestPath?: string
    availableRenditions?: string[]
    timestamp?: string
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders)
  }

  if (payload?.event !== 'pipeline_status_update') {
    return jsonResponse({ error: 'Unexpected event', code: 'invalid_event' }, 400, corsHeaders)
  }
  if (payload.videoId && payload.videoId !== videoId) {
    return jsonResponse({ error: 'videoId mismatch', code: 'video_id_mismatch' }, 400, corsHeaders)
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(videoId) || videoId.includes('..')) {
    return jsonResponse({ error: 'Invalid video id', code: 'invalid_video_id' }, 400, corsHeaders)
  }

  const stage = String(payload.stage ?? '').trim()
  if (stage !== 'preview_ready' && stage !== 'fully_processed') {
    return jsonResponse({ error: 'Invalid stage', code: 'invalid_stage' }, 400, corsHeaders)
  }

  try {
    const db = getDb(env)
    const existing = await db.prepare('SELECT id FROM videos WHERE id = ?').bind(videoId).first()
    if (!existing) {
      return jsonResponse({ error: 'Video not found', code: 'not_found' }, 404, corsHeaders)
    }

    await db.prepare(`
      UPDATE videos SET status = 'processed', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(videoId).run()

    log({ service: 'pipeline', event: 'pipeline_status_updated', video_id: videoId, stage })

    if (stage === 'fully_processed' && env.RATE_LIMIT_KV) {
      await env.RATE_LIMIT_KV.delete(`duration:${videoId}`)
    }

    return jsonResponse({ ok: true }, 200, corsHeaders)
  } catch (e) {
    console.error('handleVideoPipelineStatus:', e)
    return jsonResponse({ error: 'Internal server error', code: 'internal_error' }, 500, corsHeaders)
  }
}
