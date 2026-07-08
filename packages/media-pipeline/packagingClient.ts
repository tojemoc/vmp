/**
 * Register and resolve encore-packager jobs via the supervisor HTTP API.
 * Supervisor owns Redis zAdd to packaging-queue and packager callbacks.
 */

import type { PackagingStage } from './pipelineMode.js'
import type { PipelineMode } from './pipelineMode.js'

const SUPERVISOR_BASE = (process.env.VMP_SUPERVISOR_URL || `http://127.0.0.1:${process.env.VMP_UI_PORT || '8788'}`).trim().replace(/\/+$/, '')
const PACKAGING_POLL_MS = Math.max(500, Number.parseInt(process.env.PACKAGING_POLL_MS || '2000', 10) || 2000)
const PACKAGING_TIMEOUT_MS = Math.max(60_000, Number.parseInt(process.env.PACKAGING_TIMEOUT_MS || '3600000', 10) || 3_600_000)
const PACKAGING_SECRET = (process.env.VMP_PACKAGING_SECRET || process.env.VMP_WEBHOOK_SECRET || '').trim()
const PACKAGING_FETCH_TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.PACKAGING_FETCH_TIMEOUT_MS || '15000', 10) || 15_000)

function packagingAuthHeaders(): Record<string, string> {
  if (!PACKAGING_SECRET) return {}
  return { 'X-VMP-Packaging-Secret': PACKAGING_SECRET }
}

function httpStatusFromPackagingError(err: Error): number | null {
  const match = err.message.match(/\bHTTP (\d{3})\b/)
  if (!match) return null
  const status = Number.parseInt(match[1], 10)
  return Number.isFinite(status) ? status : null
}

function isTransientPackagingFetchError(err: unknown): boolean {
  if (err instanceof SyntaxError) return false
  if (!(err instanceof Error)) return false

  const status = httpStatusFromPackagingError(err)
  if (status != null) {
    if (status >= 500 && status <= 599) return true
    if (status === 408 || status === 429) return true
    return false
  }

  const msg = err.message.toLowerCase()
  return msg.includes('fetch failed')
    || msg.includes('network')
    || msg.includes('econnrefused')
    || msg.includes('econnreset')
    || msg.includes('etimedout')
    || msg.includes('socket')
    || err.name === 'AbortError'
}

export type PackagingRegistration = {
  jobId: string
  encoreJobUrl: string
  videoId: string
  stage: PackagingStage
  pipelineMode: PipelineMode
}

export type PackagingStatus = {
  status: 'pending' | 'success' | 'failed'
  outputPath?: string
  error?: string
  stage?: PackagingStage
  pipelineMode?: PipelineMode
  videoId?: string
}

export async function registerAndEnqueuePackaging(reg: PackagingRegistration): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PACKAGING_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${SUPERVISOR_BASE}/api/packaging/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...packagingAuthHeaders() },
      body: JSON.stringify(reg),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`packaging enqueue failed: HTTP ${res.status} ${text.slice(0, 300)}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function waitForPackaging(jobId: string): Promise<PackagingStatus> {
  const started = Date.now()
  while (Date.now() - started <= PACKAGING_TIMEOUT_MS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PACKAGING_FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(`${SUPERVISOR_BASE}/api/packaging/status/${encodeURIComponent(jobId)}`, {
        headers: packagingAuthHeaders(),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`packaging status failed: HTTP ${res.status} ${text.slice(0, 200)}`)
      }
      const body = (await res.json()) as PackagingStatus
      if (body.status === 'success' || body.status === 'failed') return body
    } catch (err) {
      if (!isTransientPackagingFetchError(err)) throw err
      process.stderr.write(
        `[packaging] status poll retry for ${jobId}: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    } finally {
      clearTimeout(timeout)
    }
    await new Promise((r) => setTimeout(r, PACKAGING_POLL_MS))
  }
  throw new Error(`packaging job ${jobId} timed out after ${PACKAGING_TIMEOUT_MS}ms`)
}
