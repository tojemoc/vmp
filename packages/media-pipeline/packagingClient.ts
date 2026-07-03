/**
 * Register and resolve encore-packager jobs via the supervisor HTTP API.
 * Supervisor owns Redis zAdd to packaging-queue and packager callbacks.
 */

import type { PackagingStage } from './pipelineMode.js'
import type { PipelineMode } from './pipelineMode.js'

const SUPERVISOR_BASE = (process.env.VMP_SUPERVISOR_URL || `http://127.0.0.1:${process.env.VMP_UI_PORT || '8788'}`).trim().replace(/\/+$/, '')
const PACKAGING_POLL_MS = Math.max(500, Number.parseInt(process.env.PACKAGING_POLL_MS || '2000', 10) || 2000)
const PACKAGING_TIMEOUT_MS = Math.max(60_000, Number.parseInt(process.env.PACKAGING_TIMEOUT_MS || '3600000', 10) || 3_600_000)
const PACKAGING_MODE = (process.env.PACKAGING_MODE || 'queue').trim().toLowerCase()

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

export function usesQueuedPackaging(): boolean {
  return PACKAGING_MODE !== 'inline'
}

export async function registerAndEnqueuePackaging(reg: PackagingRegistration): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(`${SUPERVISOR_BASE}/api/packaging/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(`${SUPERVISOR_BASE}/api/packaging/status/${encodeURIComponent(jobId)}`, {
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`packaging status failed: HTTP ${res.status} ${text.slice(0, 200)}`)
      }
      const body = (await res.json()) as PackagingStatus
      if (body.status === 'success' || body.status === 'failed') return body
    } catch (err) {
      // Transient failure (network error, timeout, parse error) - continue polling unless we've exceeded overall timeout
      clearTimeout(timeout)
      await new Promise((r) => setTimeout(r, PACKAGING_POLL_MS))
      continue
    } finally {
      clearTimeout(timeout)
    }
    await new Promise((r) => setTimeout(r, PACKAGING_POLL_MS))
  }
  throw new Error(`packaging job ${jobId} timed out after ${PACKAGING_TIMEOUT_MS}ms`)
}
