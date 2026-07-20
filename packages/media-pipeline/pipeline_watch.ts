#!/usr/bin/env node
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, readdir, readFile, rm, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  beginTtpJob,
  emitTtp,
  emitTtpSummary,
  setTtpSourceDuration,
} from './ttpLog.js'
import { gauge, histogram, increment } from './metrics.js'
import {
  checkEncoreHealth,
  transcodeRenditionWithEncore,
  type EncoreRenditionKey,
} from './encoreClient.js'
import { type PipelineMode, ingestLabelForMode, packagingStageToPipelineStage } from './pipelineMode.js'
import { runQueuedPipelineJob } from './runQueuedPipelineJob.js'
import {
  objectKey,
  uploadDirectoryToStorage,
  uploadFileToStorage,
  verifyStorageDirectory,
} from './storage.js'

type PipelineStatus = 'active' | 'success' | 'failed' | 'paused'
type PipelineStage =
  | 'detected' | 'deduped' | 'wait_upload_complete' | 'probe'
  | 'phase1_encode' | 'phase1_upload' | 'phase1_available'
  | 'phase2_encode' | 'phase2_package' | 'phase2_upload' | 'phase2_manifest_swap' | 'multi_rendition_ready'
  | 'podcast_mp3' | 'preview_wait' | 'preview_render' | 'preview_upload' | 'cleanup' | 'done' | 'failed'
  | 'paused' | 'resumed' | 'stopped'
type QueueJob = { videoId: string, inputPath: string, source: string, pipelineMode: PipelineMode }
type RunResult = { stdout: string, stderr: string }
type RunOptions = { capture?: boolean, videoId?: string }
type ResolveInputTargetPathResult = { videoId: string, targetPath: string, renamed: boolean, reason?: 'legacy_filename' | 'random_uuid' | 'already_uuid' }
type RenditionKey = '1080p' | '720p' | '480p'
type Phase1Result = { audioTmpPath: string | null, hasAudio: boolean }
type JobPhase = 'phase1' | 'phase2' | 'podcast' | 'preview' | 'upload'
type JobHandle = {
  videoId: string
  children: Set<ChildProcess>
  status: 'running' | 'paused' | 'stopping'
  phase: JobPhase
}
type ProgressPhase = JobPhase

const LEGACY_INBOX_DIR = (process.env.INBOX_DIR || '').trim()
const INBOX_FAST_LANE_DIR = (process.env.INBOX_FAST_LANE_DIR || '').trim()
  || (LEGACY_INBOX_DIR ? path.join(LEGACY_INBOX_DIR, 'fast-lane') : '/mnt/videos/inbox-fast-lane')
const INBOX_FULL_LADDER_DIR = (process.env.INBOX_FULL_LADDER_DIR || '').trim()
  || (LEGACY_INBOX_DIR ? path.join(LEGACY_INBOX_DIR, 'full-ladder') : '/mnt/videos/inbox-full-ladder')
const TMP_DIR_BASE = (process.env.TMP_DIR_BASE || '/mnt/tmp/video_pipeline').trim()

type InboxWatchConfig = {
  dir: string
  pipelineMode: PipelineMode
  label: string
}

const INBOX_WATCHES: InboxWatchConfig[] = [
  { dir: INBOX_FAST_LANE_DIR, pipelineMode: 'fast_lane', label: 'fast-lane' },
  { dir: INBOX_FULL_LADDER_DIR, pipelineMode: 'full_ladder', label: 'full-ladder' },
]
const MAX_JOBS = Math.max(1, Number.parseInt(process.env.MAX_JOBS || '2', 10) || 2)
const MP3_BITRATE = (process.env.MP3_BITRATE || '128k').trim()
const PREVIEW_MP3_ENABLED = process.env.PREVIEW_MP3_ENABLED !== '0'
const PREVIEW_MP3_SECONDS = Math.max(1, Number.parseInt(process.env.PREVIEW_MP3_SECONDS || '180', 10) || 180)
const PREVIEW_MP3_LOCK_SECONDS = Math.max(0, Number.parseInt(process.env.PREVIEW_MP3_LOCK_SECONDS || '60', 10) || 60)
const VIDEO_ID_STRATEGY = (process.env.VIDEO_ID_STRATEGY || 'random').trim()
const VIDEO_ID_SANITIZE_MODE = (process.env.VIDEO_ID_SANITIZE_MODE || 'slug-hash').trim()
const WAIT_STABLE_TIMEOUT_MS = Math.max(1_000, Number.parseInt(process.env.WAIT_STABLE_TIMEOUT_MS || '120000', 10) || 120000)
const WAIT_STABLE_POLL_MS = Math.max(250, Number.parseInt(process.env.WAIT_STABLE_POLL_MS || '2000', 10) || 2000)
const WAIT_STABLE_IDLE_POLLS = Math.max(1, Number.parseInt(process.env.WAIT_STABLE_IDLE_POLLS || '1', 10) || 1)
const VMP_API_BASE_URL = (process.env.VMP_API_BASE_URL || '').trim().replace(/\/+$/, '')
const VMP_API_PIPELINE_SECRET = (process.env.VMP_API_PIPELINE_SECRET || '').trim()
const PIPELINE_CALLBACK_TIMEOUT_MS = Math.max(5_000, Number.parseInt(process.env.PIPELINE_CALLBACK_TIMEOUT_MS || '15000', 10) || 15_000)
const HLS_AUDIO_GROUP_ID = 'audio'
const HLS_AUDIO_PLAYLIST = 'audio.m3u8'

const RENDITION_CONFIG: Record<RenditionKey, { out: string, w: string, h: string, br: string, max: string, buf: string, abr: string }> = {
  '1080p': { out: '1080p.mp4', w: '1920', h: '1080', br: '5M', max: '5M', buf: '10M', abr: '128k' },
  '720p': { out: '720p.mp4', w: '1280', h: '720', br: '3M', max: '3M', buf: '6M', abr: '128k' },
  '480p': { out: '480p.mp4', w: '854', h: '480', br: '1500k', max: '1500k', buf: '3000k', abr: '96k' },
}

function log(msg: string): void {
  process.stdout.write(`${new Date().toISOString()} ${msg}\n`)
}

let shuttingDown = false
const jobHandles = new Map<string, JobHandle>()
/** Inbox MP4 path (original or renamed) per active/cancelled job — cleaned on stop/cancel. */
const jobInputPaths = new Map<string, string>()
const fallbackChildren = new Set<ChildProcess>()
const stoppedVideos = new Set<string>()

function ensureJobHandle(videoId: string, phase: JobPhase = 'phase1'): JobHandle {
  const existing = jobHandles.get(videoId)
  if (existing) {
    existing.phase = phase
    return existing
  }
  const handle: JobHandle = { videoId, children: new Set(), status: 'running', phase }
  jobHandles.set(videoId, handle)
  return handle
}

function setJobPhase(videoId: string, phase: JobPhase): void {
  const handle = jobHandles.get(videoId)
  if (handle) handle.phase = phase
}

function trackChild<T extends ChildProcess>(child: T, videoId?: string): T {
  if (videoId) {
    const handle = ensureJobHandle(videoId)
    handle.children.add(child)
    if (handle.status === 'paused' || handle.status === 'stopping') {
      try { child.kill('SIGSTOP') } catch {}
    }
    const clear = () => handle.children.delete(child)
    child.once('close', clear)
    child.once('error', clear)
  } else {
    fallbackChildren.add(child)
    const clear = () => fallbackChildren.delete(child)
    child.once('close', clear)
    child.once('error', clear)
  }
  return child
}

function isJobStopped(videoId: string): boolean {
  return stoppedVideos.has(videoId) || jobHandles.get(videoId)?.status === 'stopping'
}

function isJobPaused(videoId: string): boolean {
  return jobHandles.get(videoId)?.status === 'paused'
}

class JobStoppedError extends Error {
  constructor(readonly videoId: string) {
    super(`Job stopped: ${videoId}`)
    this.name = 'JobStoppedError'
  }
}

function assertNotStopped(videoId: string): void {
  if (isJobStopped(videoId)) throw new JobStoppedError(videoId)
}

async function waitWhilePaused(videoId: string): Promise<void> {
  while (isJobPaused(videoId)) {
    assertNotStopped(videoId)
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function cleanupJobArtifacts(videoId: string, lockFile?: string, inputPath?: string): Promise<void> {
  const tmpDir = path.join(TMP_DIR_BASE, videoId)
  await rm(tmpDir, { recursive: true, force: true })

  const inboxPath = inputPath
  if (inboxPath) {
    await rm(inboxPath, { force: true })
    jobInputPaths.delete(videoId)
  }

  if (lockFile) await rm(lockFile, { force: true })
}

async function cleanupCancelledJob(videoId: string, lockFile: string, inputPath?: string): Promise<void> {
  await cleanupJobArtifacts(videoId, lockFile, inputPath)
  videoDurations.delete(videoId)
  progressEmitState.delete(videoId)
  jobHandles.delete(videoId)
  stoppedVideos.delete(videoId)
}

export function pauseJob(videoId: string): void {
  const handle = jobHandles.get(videoId)
  if (!handle) return
  for (const child of handle.children) {
    try { child.kill('SIGSTOP') } catch {}
  }
  handle.status = 'paused'
  emitPipelineEvent(videoId, 'paused', 'paused', '')
}

export function resumeJob(videoId: string): void {
  const handle = jobHandles.get(videoId)
  if (!handle) return
  for (const child of handle.children) {
    try { child.kill('SIGCONT') } catch {}
  }
  handle.status = 'running'
  emitPipelineEvent(videoId, 'resumed', 'active', '')
}

async function waitForChildrenExit(children: Set<ChildProcess>, timeoutMs: number): Promise<void> {
  const pending = [...children]
  if (pending.length === 0) return
  await Promise.race([
    Promise.all(pending.map((child) => new Promise<void>((resolve) => {
      if (child.exitCode != null || child.signalCode != null) {
        resolve()
        return
      }
      child.once('close', () => resolve())
      child.once('error', () => resolve())
    }))),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ])
  for (const child of pending) {
    if (child.exitCode == null && child.signalCode == null) {
      try { child.kill('SIGKILL') } catch {}
    }
  }
}

export async function stopJob(videoId: string): Promise<void> {
  stoppedVideos.add(videoId)
  removeQueuedJobs(videoId)
  const handle = jobHandles.get(videoId)
  const inputPath = jobInputPaths.get(videoId)
  if (!handle) {
    await cleanupJobArtifacts(videoId, undefined, inputPath)
    emitPipelineEvent(videoId, 'stopped', 'failed', 'stopped_by_user')
    return
  }
  handle.status = 'stopping'
  for (const child of handle.children) {
    try { child.kill('SIGTERM') } catch {}
  }
  await waitForChildrenExit(handle.children, 5000)
  await cleanupJobArtifacts(videoId, undefined, inputPath)
  emitPipelineEvent(videoId, 'stopped', 'failed', 'stopped_by_user')
  jobHandles.delete(videoId)
}

function emitPipelineEvent(videoId: string, stage: PipelineStage, status: PipelineStatus, detail = ''): void {
  process.stdout.write(`VMP_PIPELINE_EVENT\t${videoId}\t${stage}\t${status}\t${detail}\n`)
}

/** Cumulative overall progress checkpoints (0–1) for non-encode stages. */
const PROGRESS = {
  PROBE: 0.02,
  P1_ENCODE: { base: 0.02, span: 0.25 },
  P1_DONE: 0.30,
  P2_720: { base: 0.30, span: 0.10 },
  P2_1080: { base: 0.40, span: 0.10 },
  P2_480: { base: 0.50, span: 0.15 },
  P2_PACKAGE: { base: 0.65, span: 0.07 },
  P2_UPLOAD: { base: 0.72, span: 0.08 },
  P2_DONE: 0.80,
  PODCAST: { base: 0.80, span: 0.08 },
  PREVIEW: { base: 0.88, span: 0.08 },
  DONE: 1.0,
} as const

const videoDurations = new Map<string, number>()
const progressEmitState = new Map<string, { lastAt: number, lastOverall: number }>()

type PipelineProgressPayload = {
  videoId: string
  stage: string
  phase: ProgressPhase
  rendition: string
  stageProgress: number
  overallProgress: number
  speed?: number | null
  etaSec?: number | null
  timeSec?: number | null
  detail?: string
}

function stageToProgressPhase(stage: PipelineStage): ProgressPhase {
  if (stage.startsWith('phase1') || stage === 'phase1_available') return 'phase1'
  if (stage.startsWith('phase2') || stage === 'multi_rendition_ready') return 'phase2'
  if (stage === 'podcast_mp3') return 'podcast'
  if (stage.startsWith('preview')) return 'preview'
  if (stage.includes('upload')) return 'upload'
  if (stage === 'probe' || stage === 'wait_upload_complete' || stage === 'detected') return 'phase1'
  return 'phase1'
}

function emitPipelineProgress(payload: PipelineProgressPayload): void {
  process.stdout.write(`VMP_PIPELINE_PROGRESS\t${JSON.stringify(payload)}\n`)
}

function emitProgressCheckpoint(
  videoId: string,
  stage: PipelineStage,
  overallProgress: number,
  detail = '',
  rendition = '',
): void {
  emitPipelineProgress({
    videoId,
    stage,
    phase: stageToProgressPhase(stage),
    rendition,
    stageProgress: 1,
    overallProgress,
    detail,
  })
  progressEmitState.set(videoId, { lastAt: Date.now(), lastOverall: overallProgress })
}

function maybeEmitEncodeProgress(
  videoId: string,
  stage: PipelineStage,
  rendition: string,
  timeSec: number,
  durationSec: number,
  overallBase: number,
  overallSpan: number,
  speed: number | null,
  phase: ProgressPhase,
): void {
  const stageProgress = Math.min(1, Math.max(0, timeSec / durationSec))
  const overallProgress = Math.min(0.99, overallBase + overallSpan * stageProgress)
  const state = progressEmitState.get(videoId) ?? { lastAt: 0, lastOverall: -1 }
  const now = Date.now()
  if (now - state.lastAt < 2000 && overallProgress - state.lastOverall < 0.005) return
  progressEmitState.set(videoId, { lastAt: now, lastOverall: overallProgress })
  const etaSec = speed != null && speed > 0
    ? Math.max(0, Math.round((durationSec - timeSec) / speed))
    : null
  emitPipelineProgress({
    videoId,
    stage,
    phase,
    rendition,
    stageProgress,
    overallProgress,
    speed,
    etaSec,
    timeSec,
  })
}

function parseFfmpegTime(text: string): number | null {
  const m = text.match(/\btime=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)\b/)
  if (!m) return null
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return Number.isFinite(sec) ? sec : null
}

function parseFfmpegSpeed(text: string): number | null {
  const m = text.match(/\bspeed=\s*([\d.]+)x\b/)
  if (!m) return null
  const v = Number.parseFloat(m[1])
  return Number.isFinite(v) && v > 0 ? v : null
}

type FfmpegProgressOptions = {
  videoId: string
  stage: PipelineStage
  rendition: string
  durationSec: number | null
  overallBase: number
  overallSpan: number
  phase: ProgressPhase
}

function runFfmpeg(args: string[], label: string, progress: FfmpegProgressOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = trackChild(spawn('ffmpeg', args, { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] }), progress.videoId)
    let stderrBuf = ''

    const onProgressText = (text: string) => {
      process.stderr.write(text)
      const durationSec = progress.durationSec
      if (durationSec == null || durationSec <= 0) return
      const timeSec = parseFfmpegTime(text)
      if (timeSec == null) return
      maybeEmitEncodeProgress(
        progress.videoId,
        progress.stage,
        progress.rendition,
        timeSec,
        durationSec,
        progress.overallBase,
        progress.overallSpan,
        parseFfmpegSpeed(text),
        progress.phase,
      )
    }

    child.stderr.on('data', (d) => {
      stderrBuf += d.toString()
      const parts = stderrBuf.split(/\r|\n/)
      stderrBuf = parts.pop() ?? ''
      for (const part of parts) {
        if (part.trim()) onProgressText(`${part}\n`)
      }
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (stderrBuf.trim()) onProgressText(`${stderrBuf}\n`)
      if (code === 0) return resolve()
      reject(new Error(`${label} failed exit=${code}`))
    })
  })
}

function run(command: string, args: string[], label: string, { capture = false, videoId }: RunOptions = {}): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = trackChild(spawn(command, args, { env: process.env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] }), videoId)
    let stdout = ''
    let stderr = ''
    if (capture) {
      child.stdout.on('data', (d) => { stdout += d.toString() })
      child.stderr.on('data', (d) => { stderr += d.toString() })
    }
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr })
      reject(new Error(`${label} failed exit=${code}${capture ? ` stderr=${stderr.slice(-400)}` : ''}`))
    })
  })
}

async function storageCopyDir(localDir: string, keyPrefix: string, label: string, videoId?: string): Promise<void> {
  await uploadDirectoryToStorage(localDir, keyPrefix, label)
  if (videoId) log(`[${videoId}] ${label}`)
}

async function storageCopyFile(localFile: string, key: string, label: string, videoId?: string): Promise<void> {
  await uploadFileToStorage(localFile, key, label)
  if (videoId) log(`[${videoId}] ${label}`)
}

async function storageCopySharedAudioAssets(tmpDir: string, keyPrefix: string, label: string, videoId?: string): Promise<void> {
  const uploads: Promise<void>[] = []
  const initPath = path.join(tmpDir, 'init_audio.mp4')
  if (existsSync(initPath)) {
    uploads.push(uploadFileToStorage(initPath, objectKey(keyPrefix, 'init_audio.mp4'), `${label} init_audio`))
  }
  const playlistPath = path.join(tmpDir, HLS_AUDIO_PLAYLIST)
  if (existsSync(playlistPath)) {
    uploads.push(uploadFileToStorage(playlistPath, objectKey(keyPrefix, HLS_AUDIO_PLAYLIST), `${label} audio playlist`))
  }
  const entries = await readdir(tmpDir)
  for (const file of entries) {
    if (/^seg_audio_\d+\.m4s$/.test(file)) {
      uploads.push(uploadFileToStorage(path.join(tmpDir, file), objectKey(keyPrefix, file), `${label} ${file}`))
    }
  }
  if (uploads.length) await Promise.all(uploads)
  if (videoId) log(`[${videoId}] ${label}`)
}

async function storageCheckDir(localDir: string, keyPrefix: string, label: string, videoId?: string): Promise<void> {
  await verifyStorageDirectory(localDir, keyPrefix, label)
  if (videoId) log(`[${videoId}] ${label}`)
}

function hash8(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function sanitizeVideoId(stem: string): string {
  if (VIDEO_ID_SANITIZE_MODE === 'none') return stem
  if (VIDEO_ID_SANITIZE_MODE === 'base64url') return Buffer.from(stem).toString('base64url') || 'dmlkZW8'
  const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '').replace(/-{2,}/g, '-') || 'video'
  if (VIDEO_ID_SANITIZE_MODE === 'slug') return slug
  if (/^[a-z0-9-]+$/.test(stem)) return stem
  return `${slug}-${hash8(stem)}`
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

async function waitStableSize(filePath: string): Promise<void> {
  let prev = -1
  let idlePolls = 0
  const startedAt = Date.now()
  while (Date.now() - startedAt <= WAIT_STABLE_TIMEOUT_MS) {
    const s = (await stat(filePath)).size
    if (s === prev) {
      idlePolls += 1
      if (idlePolls >= WAIT_STABLE_IDLE_POLLS) return
    } else {
      idlePolls = 0
    }
    prev = s
    await new Promise((r) => setTimeout(r, WAIT_STABLE_POLL_MS))
  }
  throw new Error(`wait_stable_timeout after ${WAIT_STABLE_TIMEOUT_MS}ms`)
}

async function probeSource(filePath: string, videoId?: string): Promise<{ hasAudio: boolean, durationSec: number | null }> {
  let hasAudio = false
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath], 'ffprobe audio', { capture: true, videoId })
    hasAudio = stdout.trim().length > 0
  } catch {
    hasAudio = false
  }
  let durationSec: number | null = null
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      'ffprobe duration',
      { capture: true, videoId },
    )
    const parsed = Number.parseFloat(stdout.trim())
    if (Number.isFinite(parsed) && parsed > 0) durationSec = parsed
  } catch {
    durationSec = null
  }
  return { hasAudio, durationSec }
}

async function notifyVideoAvailable(
  videoId: string,
  stage: 'preview_ready' | 'fully_processed',
  availableRenditions: RenditionKey[],
): Promise<void> {
  if (!VMP_API_BASE_URL || !VMP_API_PIPELINE_SECRET) {
    log(`⚠️ ${videoId}: pipeline status callback skipped (VMP_API_BASE_URL or VMP_API_PIPELINE_SECRET unset)`)
    return
  }

  const payload = {
    event: 'pipeline_status_update',
    videoId,
    stage,
    hlsManifestPath: `videos/${videoId}/master.m3u8`,
    availableRenditions,
    timestamp: new Date().toISOString(),
  }
  const rawBody = JSON.stringify(payload)
  const url = `${VMP_API_BASE_URL}/api/admin/videos/${encodeURIComponent(videoId)}/pipeline-status`

  const attempt = async (retry: boolean): Promise<void> => {
    const ts = String(Math.floor(Date.now() / 1000))
    const signature = crypto.createHmac('sha256', VMP_API_PIPELINE_SECRET).update(`${ts}.${rawBody}`, 'utf8').digest('hex')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PIPELINE_CALLBACK_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VMP-Signature': `sha256=${signature}`,
          'X-VMP-Timestamp': ts,
        },
        body: rawBody,
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`)
      }
      if (stage === 'preview_ready') {
        await emitTtp(videoId, 'api_minimal_publish_ready', { httpStatus: res.status })
      } else if (stage === 'fully_processed') {
        await emitTtp(videoId, 'api_full_renditions_ready', { httpStatus: res.status })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!retry) {
        log(`⚠️ ${videoId}: pipeline status callback failed (${stage}), retrying in 5s: ${msg}`)
        await new Promise((r) => setTimeout(r, 5000))
        return attempt(true)
      }
      log(`⚠️ ${videoId}: pipeline status callback gave up (${stage}): ${msg}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  await attempt(false)
}

async function completePipelineSuccess(
  videoId: string,
  inputPath: string,
  tmpDir: string,
  doneFlag: string,
  jobStartMs: number,
  source: string,
): Promise<void> {
  emitPipelineEvent(videoId, 'cleanup', 'active', 'start')
  await writeFile(doneFlag, 'done')
  await rm(inputPath, { force: true })
  jobInputPaths.delete(videoId)
  await rm(tmpDir, { recursive: true, force: true })
  emitPipelineEvent(videoId, 'done', 'success', 'watchfolder_and_tmp_cleared')
  emitProgressCheckpoint(videoId, 'done', PROGRESS.DONE, 'complete')
  await emitTtp(videoId, 'pipeline_done', {})
  await emitTtpSummary(videoId, 'success')
  histogram('vmp.transcoder.job.duration_ms', Date.now() - jobStartMs, { outcome: 'success', source })
  increment('vmp.transcoder.job.success', 1, { source })
  videoDurations.delete(videoId)
  progressEmitState.delete(videoId)
  jobHandles.delete(videoId)
  stoppedVideos.delete(videoId)
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: process exists but we cannot signal it (still a live lock holder).
    // ESRCH / other: PID is gone or not usable — treat as dead.
    return Boolean(err && typeof err === 'object' && 'code' in err && err.code === 'EPERM')
  }
}

/** Skip only when another live process holds the lock; reclaim stale locks from prior container runs. */
async function reclaimOrSkipLock(lockFile: string, videoId: string): Promise<'skip' | 'proceed'> {
  if (!existsSync(lockFile)) return 'proceed'
  let ownerPid: number
  try {
    ownerPid = Number.parseInt((await readFile(lockFile, 'utf8')).trim(), 10)
  } catch {
    ownerPid = Number.NaN
  }
  if (Number.isInteger(ownerPid) && ownerPid > 0 && ownerPid !== process.pid && isPidAlive(ownerPid)) {
    emitPipelineEvent(videoId, 'deduped', 'active', `already_processing pid=${ownerPid}`)
    log(`⏭️  ${videoId} skipped: lock held by live pid=${ownerPid}`)
    return 'skip'
  }
  log(`♻️  ${videoId} reclaiming stale lock (owner=${Number.isFinite(ownerPid) ? ownerPid : 'unknown'})`)
  await rm(lockFile, { force: true })
  return 'proceed'
}

async function clearOrphanLocksAtStartup(): Promise<void> {
  if (!existsSync(TMP_DIR_BASE)) return
  const entries = await readdir(TMP_DIR_BASE).catch(() => [] as string[])
  let cleared = 0
  for (const name of entries) {
    const lockFile = path.join(TMP_DIR_BASE, name, '.lock')
    if (!existsSync(lockFile)) continue
    let ownerPid: number
    try {
      ownerPid = Number.parseInt((await readFile(lockFile, 'utf8')).trim(), 10)
    } catch {
      ownerPid = Number.NaN
    }
    if (Number.isInteger(ownerPid) && ownerPid > 0 && isPidAlive(ownerPid)) continue
    await rm(lockFile, { force: true })
    cleared += 1
  }
  if (cleared > 0) log(`♻️  Cleared ${cleared} orphan job lock(s) under ${TMP_DIR_BASE}`)
}

async function processVideo(videoId: string, inputPath: string, source: string, pipelineMode: PipelineMode): Promise<void> {
  const jobStartMs = Date.now()
  increment('vmp.transcoder.job.started', 1, { source, pipeline_mode: pipelineMode })
  const tmpDir = path.join(TMP_DIR_BASE, videoId)
  const doneFlag = path.join(tmpDir, '.done')
  const lockFile = path.join(tmpDir, '.lock')
  let cancelled = false
  if (isJobStopped(videoId)) return
  await mkdir(tmpDir, { recursive: true })
  if (existsSync(doneFlag)) {
    emitPipelineEvent(videoId, 'done', 'success', 'already_done')
    log(`⏭️  ${videoId} skipped: already done (${doneFlag})`)
    return
  }
  if ((await reclaimOrSkipLock(lockFile, videoId)) === 'skip') return
  await writeFile(lockFile, String(process.pid))
  jobInputPaths.set(videoId, inputPath)
  ensureJobHandle(videoId, 'phase1')
  await emitTtp(videoId, 'processing_started', { pipelineMode })
  emitPipelineEvent(videoId, 'detected', 'active', `source=${source} mode=${pipelineMode}`)
  log(`🎬 ${videoId} processing started (${pipelineMode}) input=${inputPath}`)
  try {
    assertNotStopped(videoId)
    await waitWhilePaused(videoId)
    emitPipelineEvent(videoId, 'wait_upload_complete', 'active', 'waiting_for_file_stability')
    await waitStableSize(inputPath)
    assertNotStopped(videoId)
    await waitWhilePaused(videoId)
    emitPipelineEvent(videoId, 'wait_upload_complete', 'active', 'stable')
    await emitTtp(videoId, 'file_stable', {})

    emitPipelineEvent(videoId, 'probe', 'active', 'probing_streams')
    const { hasAudio, durationSec } = await probeSource(inputPath, videoId)
    assertNotStopped(videoId)
    await waitWhilePaused(videoId)
    if (durationSec != null) {
      setTtpSourceDuration(videoId, durationSec)
      videoDurations.set(videoId, durationSec)
    }
    await emitTtp(videoId, 'probe_complete', { hasAudio })
    emitPipelineEvent(videoId, 'probe', 'active', `hasAudio=${hasAudio}${durationSec != null ? ` durationSec=${durationSec.toFixed(1)}` : ''}`)
    emitProgressCheckpoint(videoId, 'probe', PROGRESS.PROBE, 'probe complete')

    await runQueuedPipelineJob({
      videoId,
      inputPath,
      pipelineMode,
      tmpDir,
      hasAudio,
      isCancelled: () => isJobStopped(videoId),
      emitStage: (packagingStage, subStage, status, detail) => {
        const pipelineStage = packagingStageToPipelineStage(packagingStage, subStage)
        emitPipelineEvent(videoId, pipelineStage, status as PipelineStatus, detail)
      },
      notifyVideoAvailable: (stage, renditions) => notifyVideoAvailable(videoId, stage, renditions as RenditionKey[]),
    })

    assertNotStopped(videoId)
    await waitWhilePaused(videoId)
    await completePipelineSuccess(videoId, inputPath, tmpDir, doneFlag, jobStartMs, source)
  } catch (err) {
    if (err instanceof JobStoppedError || isJobStopped(videoId)) {
      cancelled = true
      return
    }
    const detail = err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220)
    emitPipelineEvent(videoId, 'failed', 'failed', detail)
    await emitTtp(videoId, 'pipeline_failed', { error: detail })
    await emitTtpSummary(videoId, 'failed', detail)
    histogram('vmp.transcoder.job.duration_ms', Date.now() - jobStartMs, { outcome: 'failed', source })
    increment('vmp.transcoder.job.failed', 1, { source })
    log(`❌ ${videoId} failed: ${err instanceof Error ? err.message : String(err)}`)
    await rm(lockFile, { force: true })
    videoDurations.delete(videoId)
    progressEmitState.delete(videoId)
    // Allow the same inbox UUID to be picked up again (restart or later rescan/retry).
    enqueuedVideoIds.delete(videoId)
    throw err
  } finally {
    if (cancelled) {
      enqueuedVideoIds.delete(videoId)
      await cleanupCancelledJob(videoId, lockFile, inputPath)
    }
  }
}

const queue: QueueJob[] = []
let running = 0

function reportQueueMetrics(): void {
  gauge('vmp.transcoder.queue.depth', queue.length)
  gauge('vmp.transcoder.jobs.active', running)
}

/** Original inbox basename (pre-rename) → resolved path/id; prevents duplicate renames. */
const inboxIntakeByBasename = new Map<string, ResolveInputTargetPathResult>()
/** Human-readable stem → resolved path/id after first rename. */
const inboxResolvedByOriginalStem = new Map<string, ResolveInputTargetPathResult>()
const enqueuedVideoIds = new Set<string>()
let inboxIntakeChain: Promise<void> = Promise.resolve()

function isInboxVideoBasename(file: string): boolean {
  return /\.(mp4|mkv|mov)$/i.test(file)
}

function maybeEnqueueOnce(videoId: string, inputPath: string, source: string, pipelineMode: PipelineMode): void {
  if (enqueuedVideoIds.has(videoId)) return
  enqueuedVideoIds.add(videoId)
  enqueue(videoId, inputPath, source, pipelineMode)
}

function inboxFileCacheKey(inboxDir: string, file: string): string {
  return `${inboxDir}::${file}`
}

function scheduleInboxIntake(file: string, inboxDir: string, pipelineMode: PipelineMode, mechanism: string): void {
  inboxIntakeChain = inboxIntakeChain
    .then(() => intakeInboxBasename(file, inboxDir, pipelineMode, mechanism))
    .catch((err) => {
      log(`inbox intake failed for '${file}' (${inboxDir}): ${err instanceof Error ? err.message : String(err)}`)
    })
}

async function intakeInboxBasename(file: string, inboxDir: string, pipelineMode: PipelineMode, mechanism: string): Promise<void> {
  if (!isInboxVideoBasename(file)) return
  const source = `${ingestLabelForMode(pipelineMode)}:${mechanism}`
  const cacheKey = inboxFileCacheKey(inboxDir, file)

  const cachedByFile = inboxIntakeByBasename.get(cacheKey)
  if (cachedByFile) {
    maybeEnqueueOnce(cachedByFile.videoId, cachedByFile.targetPath, source, pipelineMode)
    return
  }

  const stem = file.replace(/\.[^.]+$/, '')
  const ext = file.split('.').pop() || 'mp4'
  const oldPath = path.join(inboxDir, file)

  if (isUuidLike(stem) && enqueuedVideoIds.has(stem)) return

  const cachedByStem = inboxResolvedByOriginalStem.get(stem)
  if (cachedByStem && existsSync(cachedByStem.targetPath)) {
    inboxIntakeByBasename.set(cacheKey, cachedByStem)
    maybeEnqueueOnce(cachedByStem.videoId, cachedByStem.targetPath, source, pipelineMode)
    return
  }

  if (!existsSync(oldPath)) return

  const result = await resolveInputTargetPath(stem, ext, oldPath, source)
  inboxIntakeByBasename.set(cacheKey, result)
  if (!isUuidLike(stem) || result.renamed) {
    inboxResolvedByOriginalStem.set(stem, result)
  }
  if (result.renamed) {
    const detail = result.reason === 'random_uuid' ? 'Generated random VIDEO_ID' : 'Sanitized VIDEO_ID'
    log(`🧼 ${detail} ${source}: '${stem}' -> '${result.videoId}'`)
  }
  maybeEnqueueOnce(result.videoId, result.targetPath, source, pipelineMode)
}
let ipcServer: net.Server | null = null
const ipcSocketPath = `/tmp/vmp-pipeline-${process.pid}.sock`

function removeQueuedJobs(videoId: string): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i]?.videoId === videoId) queue.splice(i, 1)
  }
}

function reorderQueue(order: string[]): void {
  const orderMap = new Map(order.map((id, index) => [id, index]))
  queue.sort((a, b) => {
    const pa = orderMap.get(a.videoId)
    const pb = orderMap.get(b.videoId)
    if (pa == null && pb == null) return 0
    if (pa == null) return 1
    if (pb == null) return -1
    return pa - pb
  })
}

type IpcCommand = {
  cmd: 'pause' | 'resume' | 'stop' | 'reorder'
  videoId?: string
  payload?: { order?: string[] }
}

function handleIpcCommand(raw: string): { ok: boolean, error?: string } {
  let parsed: IpcCommand
  try {
    parsed = JSON.parse(raw) as IpcCommand
  } catch {
    return { ok: false, error: 'invalid_json' }
  }
  const { cmd, videoId, payload } = parsed
  if (cmd === 'pause') {
    if (!videoId) return { ok: false, error: 'missing_videoId' }
    pauseJob(videoId)
    return { ok: true }
  }
  if (cmd === 'resume') {
    if (!videoId) return { ok: false, error: 'missing_videoId' }
    resumeJob(videoId)
    return { ok: true }
  }
  if (cmd === 'stop') {
    if (!videoId) return { ok: false, error: 'missing_videoId' }
    void stopJob(videoId)
    return { ok: true }
  }
  if (cmd === 'reorder') {
    const order = payload?.order
    if (!Array.isArray(order)) return { ok: false, error: 'missing_order' }
    reorderQueue(order.map(String))
    return { ok: true }
  }
  return { ok: false, error: 'unknown_cmd' }
}

async function startIpcServer(): Promise<void> {
  if (existsSync(ipcSocketPath)) {
    await unlink(ipcSocketPath)
  }
  ipcServer = net.createServer((socket) => {
    let buf = ''
    socket.on('data', (chunk) => { buf += chunk.toString() })
    socket.on('end', () => {
      const response = JSON.stringify(handleIpcCommand(buf.trim()))
      socket.end(response)
    })
    socket.on('error', () => {
      try { socket.end(JSON.stringify({ ok: false, error: 'socket_error' })) } catch {}
    })
  })
  await new Promise<void>((resolve, reject) => {
    ipcServer!.listen(ipcSocketPath, () => resolve())
    ipcServer!.on('error', reject)
  })
  process.stdout.write(`VMP_IPC_SOCKET\t${ipcSocketPath}\n`)
}

async function stopIpcServer(): Promise<void> {
  if (!ipcServer) return
  await new Promise<void>((resolve) => {
    ipcServer!.close(() => resolve())
  })
  ipcServer = null
  if (existsSync(ipcSocketPath)) {
    await unlink(ipcSocketPath).catch(() => {})
  }
}

function enqueue(videoId: string, inputPath: string, source: string, pipelineMode: PipelineMode): void {
  if (isJobStopped(videoId)) return
  beginTtpJob(videoId, source, inputPath, { pipelineMode })
  queue.push({ videoId, inputPath, source, pipelineMode })
  reportQueueMetrics()
  drain()
}

async function resolveInputTargetPath(stem: string, ext: string, oldPath: string, source: string): Promise<ResolveInputTargetPathResult> {
  const priorByStem = inboxResolvedByOriginalStem.get(stem)
  if (priorByStem && existsSync(priorByStem.targetPath)) {
    return priorByStem
  }

  if (VIDEO_ID_STRATEGY === 'filename') {
    const baseId = sanitizeVideoId(stem)
    if (baseId === stem) {
      return { videoId: baseId, targetPath: oldPath, renamed: false, reason: 'legacy_filename' }
    }
    const dir = path.dirname(oldPath)
    let attempt = 0
    while (attempt < 1000) {
      const suffix = attempt === 0 ? '' : `-${attempt}`
      const candidateId = `${baseId}${suffix}`
      const candidateFile = `${candidateId}.${ext}`
      const candidatePath = path.join(dir, candidateFile)
      if (!existsSync(candidatePath)) {
        try {
          await rename(oldPath, candidatePath)
        } catch (err) {
          const prior = inboxResolvedByOriginalStem.get(stem)
          if (isEnoent(err) && prior && existsSync(prior.targetPath)) return prior
          throw err
        }
        if (attempt > 0) {
          log(`⚠️ Filename collision in ${source}: '${oldPath}' -> '${candidatePath}' (base '${baseId}' already existed)`)
        }
        return { videoId: candidateId, targetPath: candidatePath, renamed: true, reason: 'legacy_filename' }
      }
      attempt += 1
    }
    throw new Error(`unable to resolve sanitized filename collision for ${oldPath}`)
  }

  if (isUuidLike(stem)) {
    return { videoId: stem, targetPath: oldPath, renamed: false, reason: 'already_uuid' }
  }

  const dir = path.dirname(oldPath)
  let attempt = 0
  while (attempt < 1000) {
    const candidateId = crypto.randomUUID()
    const candidateFile = `${candidateId}.${ext}`
    const candidatePath = path.join(dir, candidateFile)
    if (!existsSync(candidatePath)) {
      try {
        await rename(oldPath, candidatePath)
      } catch (err) {
        const prior = inboxResolvedByOriginalStem.get(stem)
        if (isEnoent(err) && prior && existsSync(prior.targetPath)) return prior
        throw err
      }
      return { videoId: candidateId, targetPath: candidatePath, renamed: true, reason: 'random_uuid' }
    }
    attempt += 1
  }
  throw new Error(`unable to allocate random video ID for ${oldPath}`)
}

function drain(): void {
  while (!shuttingDown && running < MAX_JOBS && queue.length > 0) {
    const job = queue.shift()
    if (!job) break
    if (isJobStopped(job.videoId)) continue
    running += 1
    reportQueueMetrics()
    processVideo(job.videoId, job.inputPath, job.source, job.pipelineMode)
      .catch(() => {})
      .finally(() => {
        running -= 1
        reportQueueMetrics()
        drain()
      })
  }
}

async function startupScan(): Promise<void> {
  await mkdir(TMP_DIR_BASE, { recursive: true })
  await clearOrphanLocksAtStartup()
  for (const watch of INBOX_WATCHES) {
    await mkdir(watch.dir, { recursive: true })
    const entries = await readdir(watch.dir)
    for (const file of entries) {
      await intakeInboxBasename(file, watch.dir, watch.pipelineMode, 'startup_scan')
    }
  }
  if (queue.length > 0 || running > 0) {
    log(`📋 startup_scan queued ${queue.length} job(s) (${running} already running)`)
  } else {
    log('📋 startup_scan: no inbox videos to process')
  }
}

function startWatcherForInbox(watch: InboxWatchConfig) {
  const child = trackChild(spawn('inotifywait', ['-m', '-e', 'close_write', '--format', '%f', watch.dir], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] }))
  let stdoutBuffer = ''
  const processLines = (lines: string[]): void => {
    const unique = [...new Set(lines.filter(Boolean))]
    for (const file of unique) {
      scheduleInboxIntake(file, watch.dir, watch.pipelineMode, 'watchfolder')
    }
  }
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString()
    const parts = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = parts.pop() ?? ''
    processLines(parts.filter(Boolean))
  })
  child.on('close', (code) => {
    if (stdoutBuffer.trim()) {
      const trailing = stdoutBuffer.trim()
      stdoutBuffer = ''
      processLines([trailing])
    }
    if (!shuttingDown) {
      log(`inotifywait exited unexpectedly (${watch.label}) code=${code ?? 'null'}`)
      process.exit(1)
    }
  })
  return child
}

function startWatcher() {
  return INBOX_WATCHES.map((watch) => startWatcherForInbox(watch))
}

function startPollingWatcher() {
  let timer: NodeJS.Timeout | null = null
  const knownByInbox = new Map<string, Set<string>>()
  for (const watch of INBOX_WATCHES) {
    knownByInbox.set(watch.dir, new Set<string>())
  }
  const poll = async () => {
    if (shuttingDown) return
    try {
      for (const watch of INBOX_WATCHES) {
        const entries = await readdir(watch.dir)
        const known = knownByInbox.get(watch.dir) ?? new Set<string>()
        const current = new Set(entries)
        for (const file of entries) {
          if (known.has(file)) continue
          if (!isInboxVideoBasename(file)) continue
          scheduleInboxIntake(file, watch.dir, watch.pipelineMode, 'polling_watchfolder')
        }
        knownByInbox.set(watch.dir, current)
      }
    } catch (err) {
      log(`polling watcher error: ${err instanceof Error ? err.message : String(err)}`)
    }
    timer = setTimeout(() => { void poll() }, 2000)
  }
  void poll()
  return {
    stop: () => {
      if (timer) clearTimeout(timer)
    },
  }
}

async function main() {
  await startIpcServer()
  await checkEncoreHealth()
  log(`🎞️  Encore API: ${(process.env.ENCORE_BASE_URL || 'http://127.0.0.1:8080').trim()}`)
  log('📦 Packaging: queue-only (encore-packager)')
  for (const watch of INBOX_WATCHES) {
    log(`📥 Inbox [${watch.label}] pipelineMode=${watch.pipelineMode}: ${watch.dir}`)
  }
  log(`☁️  Using storage bucket: ${process.env.R2_BUCKET_NAME || process.env.S3_BUCKET_NAME || 'vmp-videos'}`)
  log('🔍 Resuming existing jobs...')
  await startupScan()
  log('🎬 Watching for new uploads...')
  let watchers: Array<{ kill: (signal?: NodeJS.Signals) => boolean }> = []
  let poller: { stop: () => void } | null = null
  try {
    watchers = startWatcher()
    log(`✅ inotify watcher started (${watchers.length} inbox${watchers.length === 1 ? '' : 'es'})`)
  } catch (err) {
    log(`⚠️ inotify unavailable, falling back to polling: ${err instanceof Error ? err.message : String(err)}`)
    poller = startPollingWatcher()
  }

  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    for (const watcher of watchers) watcher.kill('SIGTERM')
    if (poller) poller.stop()
    for (const child of fallbackChildren) {
      try { child.kill('SIGTERM') } catch {}
    }
    await stopIpcServer()
    log('Shutting down pipeline watcher')
  }
  process.on('SIGTERM', () => { void shutdown() })
  process.on('SIGINT', () => { void shutdown() })
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
