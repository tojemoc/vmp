/**
 * Structured time-to-publish (TTP) logging for pipeline_watch.
 *
 * Emits one JSON line per milestone:
 *   VMP_TTP\t{...}\n
 *
 * Set VMP_TTP_LOG_PATH to append the same JSON (one object per line) to a file for analysis.
 */

import { appendFile } from 'node:fs/promises'
import { histogram } from './metrics.js'

export type TtpMilestone =
  | 'inbox_close_write'
  | 'queue_enqueued'
  | 'processing_started'
  | 'gpu_backend_detected'
  | 'file_stable'
  | 'probe_complete'
  | 'phase1_encode_start'
  | 'phase1_encode_done'
  | 'phase1_upload_start'
  | 'phase1_upload_done'
  | 'minimal_publish_ready'
  | 'api_minimal_publish_ready'
  | 'phase2_encode_start'
  | 'phase2_encode_done'
  | 'phase2_upload_start'
  | 'phase2_upload_done'
  | 'full_renditions_ready'
  | 'api_full_renditions_ready'
  | 'podcast_mp3_done'
  | 'podcast_mp3_failed'
  | 'podcast_mp3_skipped'
  | 'preview_mp3_done'
  | 'preview_mp3_skipped'
  | 'pipeline_done'
  | 'pipeline_failed'

export type TtpJobState = {
  videoId: string
  source: string
  inputPath: string
  pipelineMode: 'fast_lane' | 'full_ladder'
  inboxAtMs: number
  sourceDurationSec: number | null
  minimalReadyAtMs: number | null
  fullReadyAtMs: number | null
}

const jobs = new Map<string, TtpJobState>()

const ttpLogPath = (process.env.VMP_TTP_LOG_PATH || '').trim()

function isoNow(): string {
  return new Date().toISOString()
}

function msSinceInbox(state: TtpJobState, atMs = Date.now()): number {
  return Math.max(0, atMs - state.inboxAtMs)
}

function ratioToDuration(elapsedMs: number | null, durationSec: number | null): number | null {
  if (elapsedMs == null || elapsedMs < 0 || durationSec == null || durationSec <= 0) return null
  return Number((elapsedMs / 1000 / durationSec).toFixed(4))
}

function logTtpEmitError(milestone: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${isoNow()} VMP_TTP emit failed (${milestone}): ${msg}\n`)
}

export function beginTtpJob(
  videoId: string,
  source: string,
  inputPath: string,
  options: { pipelineMode: 'fast_lane' | 'full_ladder' },
): void {
  const inboxAtMs = Date.now()
  jobs.set(videoId, {
    videoId,
    source,
    inputPath,
    pipelineMode: options.pipelineMode,
    inboxAtMs,
    sourceDurationSec: null,
    minimalReadyAtMs: null,
    fullReadyAtMs: null,
  })
  emitTtp(videoId, 'inbox_close_write', { source, inputPath, pipelineMode: options.pipelineMode }).catch((err) =>
    logTtpEmitError('inbox_close_write', err),
  )
  emitTtp(videoId, 'queue_enqueued', { source, pipelineMode: options.pipelineMode }).catch((err) => logTtpEmitError('queue_enqueued', err))
}

export function getTtpJob(videoId: string): TtpJobState | undefined {
  return jobs.get(videoId)
}

export function setTtpSourceDuration(videoId: string, sourceDurationSec: number): void {
  const state = jobs.get(videoId)
  if (!state) return
  state.sourceDurationSec = sourceDurationSec
}

async function writeTtpPayload(payload: Record<string, unknown>): Promise<void> {
  const line = `VMP_TTP\t${JSON.stringify(payload)}\n`
  process.stdout.write(line)
  if (!ttpLogPath) return
  try {
    await appendFile(ttpLogPath, line, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`${isoNow()} VMP_TTP file append failed: ${msg}\n`)
  }
}

export async function emitTtp(
  videoId: string,
  milestone: TtpMilestone,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const state = jobs.get(videoId)
  const atMs = Date.now()
  const payload: Record<string, unknown> = {
    type: 'ttp_milestone',
    videoId,
    milestone,
    at: isoNow(),
    ...extra,
  }
  if (state) {
    payload.elapsedMsSinceInbox = msSinceInbox(state, atMs)
    payload.source = state.source
    payload.pipelineMode = state.pipelineMode
    if (state.sourceDurationSec != null) {
      payload.sourceDurationSec = state.sourceDurationSec
      payload.elapsedRatioOfSourceDuration = ratioToDuration(msSinceInbox(state, atMs), state.sourceDurationSec)
    }
    if (milestone === 'minimal_publish_ready') {
      state.minimalReadyAtMs = atMs
      payload.minimalRenditions = ['720p']
      payload.publishHint = '720p HLS on R2; suitable for minimal publish / preview access'
    }
    if (milestone === 'full_renditions_ready') {
      state.fullReadyAtMs = atMs
      payload.renditions = ['1080p', '720p', '480p']
      payload.publishHint = 'all renditions on R2; suitable for full-quality publish'
    }
  }
  await writeTtpPayload(payload)
}

export async function emitTtpSummary(videoId: string, outcome: 'success' | 'failed', detail = ''): Promise<void> {
  const state = jobs.get(videoId)
  if (!state) return
  const atMs = Date.now()
  const minimalMs = state.minimalReadyAtMs != null ? state.minimalReadyAtMs - state.inboxAtMs : null
  const fullMs = state.fullReadyAtMs != null ? state.fullReadyAtMs - state.inboxAtMs : null
  const totalMs = atMs - state.inboxAtMs
  const durationSec = state.sourceDurationSec

  await writeTtpPayload({
    type: 'ttp_summary',
    videoId,
    outcome,
    detail: detail || undefined,
    at: isoNow(),
    source: state.source,
    inputPath: state.inputPath,
    pipelineMode: state.pipelineMode,
    sourceDurationSec: durationSec,
    totalElapsedMs: totalMs,
    minimalPublishReadyElapsedMs: minimalMs,
    fullRenditionsReadyElapsedMs: fullMs,
    minimalPublishReadyRatioOfSourceDuration: ratioToDuration(minimalMs, durationSec),
    fullRenditionsReadyRatioOfSourceDuration: ratioToDuration(fullMs, durationSec),
    phase2AfterMinimalMs:
      minimalMs != null && fullMs != null ? Math.max(0, fullMs - minimalMs) : null,
  })

  if (minimalMs != null) histogram('vmp.transcoder.ttp.minimal_publish_ms', minimalMs, { outcome })
  if (fullMs != null) histogram('vmp.transcoder.ttp.full_renditions_ms', fullMs, { outcome })
  histogram('vmp.transcoder.ttp.total_ms', totalMs, { outcome })

  jobs.delete(videoId)
}
