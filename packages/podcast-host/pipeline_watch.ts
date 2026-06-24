#!/usr/bin/env node
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, readdir, rm, rename, stat, unlink, writeFile } from 'node:fs/promises'
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

type PipelineStatus = 'active' | 'success' | 'failed' | 'paused'
type PipelineStage =
  | 'detected' | 'deduped' | 'wait_upload_complete' | 'probe'
  | 'phase1_encode' | 'phase1_upload' | 'phase1_available'
  | 'phase2_encode' | 'phase2_package' | 'phase2_upload' | 'phase2_manifest_swap' | 'multi_rendition_ready'
  | 'podcast_mp3' | 'preview_wait' | 'preview_render' | 'preview_upload' | 'cleanup' | 'done' | 'failed'
  | 'paused' | 'resumed' | 'stopped'
type QueueJob = { videoId: string, inputPath: string, source: string }
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

const INBOX_DIR = (process.env.INBOX_DIR || '/mnt/videos/inbox').trim()
const TMP_DIR_BASE = (process.env.TMP_DIR_BASE || '/mnt/tmp/video_pipeline').trim()
const VAAPI_DEVICE = (process.env.VAAPI_DEVICE || '/dev/dri/renderD128').trim()
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
  P2_1080: { base: 0.30, span: 0.20 },
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

function r2Root(): string {
  const rcloneRemote = (process.env.RCLONE_REMOTE || '').trim()
  const bucketName = (process.env.R2_BUCKET_NAME || '').trim()
  const bucket = (process.env.R2_BUCKET || 'vmp-videos').trim()
  if (rcloneRemote) return bucketName ? `${rcloneRemote}:${bucketName}` : `${rcloneRemote}:`
  return bucket.includes(':') ? bucket : `${bucket}:`
}

function r2Path(relativePath: string): string {
  return `${r2Root().replace(/\/+$/, '')}/${String(relativePath).replace(/^\/+/, '')}`
}

const RCLONE_TRANSFERS = Math.max(1, Number.parseInt(process.env.RCLONE_TRANSFERS || '4', 10) || 4)
const RCLONE_CHECKERS = Math.max(1, Number.parseInt(process.env.RCLONE_CHECKERS || '8', 10) || 8)
const RCLONE_UPLOAD_CONCURRENCY = Math.max(1, Number.parseInt(process.env.RCLONE_UPLOAD_CONCURRENCY || '2', 10) || 2)

/** R2-safe rclone flags; extend with space-separated RCLONE_EXTRA_ARGS. */
function rcloneBaseArgs(): string[] {
  const args = [
    '--s3-no-check-bucket',
    `--s3-upload-concurrency=${RCLONE_UPLOAD_CONCURRENCY}`,
    '--retries', '5',
    '--low-level-retries', '10',
    '--log-level', process.env.RCLONE_LOG_LEVEL || 'NOTICE',
  ]
  const extra = (process.env.RCLONE_EXTRA_ARGS || '').trim()
  if (extra) args.push(...extra.split(/\s+/).filter(Boolean))
  return args
}

function rcloneTransferArgs(): string[] {
  return [
    ...rcloneBaseArgs(),
    '--transfers', String(RCLONE_TRANSFERS),
    '--checkers', String(RCLONE_CHECKERS),
  ]
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

function buildMasterM3u8Lines(hasAudio: boolean, videoStreamInfs: string[]): string[] {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3']
  if (hasAudio) {
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${HLS_AUDIO_GROUP_ID}",NAME="Main",DEFAULT=YES,AUTOSELECT=YES,URI="${HLS_AUDIO_PLAYLIST}"`,
    )
  }
  for (const streamInf of videoStreamInfs) {
    if (hasAudio && streamInf.startsWith('#EXT-X-STREAM-INF')) {
      lines.push(`${streamInf},AUDIO="${HLS_AUDIO_GROUP_ID}"`)
    } else {
      lines.push(streamInf)
    }
  }
  return lines
}

async function writePhase1MasterM3u8(tmpDir: string, hasAudio: boolean): Promise<void> {
  const lines = buildMasterM3u8Lines(hasAudio, [
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"',
    '720p/playlist.m3u8',
  ])
  await writeFile(path.join(tmpDir, 'master.m3u8'), `${lines.join('\n')}\n`)
}

async function writePhase2MasterM3u8(tmpDir: string, hasAudio: boolean): Promise<void> {
  const lines = buildMasterM3u8Lines(hasAudio, [
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
    '1080p/playlist.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"',
    '720p/playlist.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480,CODECS="avc1.640028,mp4a.40.2"',
    '480p/playlist.m3u8',
  ])
  await writeFile(path.join(tmpDir, 'master.m3u8'), `${lines.join('\n')}\n`)
}

/** Prefer shaka-packager master (CODECS + fMP4 version); hand-written master is fallback only. */
async function adoptShakaMasterM3u8(tmpDir: string, hasAudio: boolean, phase: 1 | 2): Promise<void> {
  const shakaMaster = path.join(tmpDir, 'master.m3u8.shaka')
  const master = path.join(tmpDir, 'master.m3u8')
  if (existsSync(shakaMaster)) {
    await rename(shakaMaster, master)
    return
  }
  log(`⚠️ shaka master missing for phase${phase}; using fallback master writer`)
  if (phase === 1) await writePhase1MasterM3u8(tmpDir, hasAudio)
  else await writePhase2MasterM3u8(tmpDir, hasAudio)
}

async function encodeRendition(
  videoId: string,
  inputPath: string,
  tmpDir: string,
  key: RenditionKey,
  options: { includeAudio: boolean, stage: PipelineStage, overallBase: number, overallSpan: number },
): Promise<string> {
  const r = RENDITION_CONFIG[key]
  emitPipelineEvent(videoId, options.stage, 'active', r.out)
  const outPath = path.join(tmpDir, `${r.out}.tmp.${process.pid}`)
  const args = [
    '-hide_banner', '-y',
    '-init_hw_device', `vaapi=vaapi0:${VAAPI_DEVICE}`,
    '-i', inputPath, '-r', '30',
    '-vf', `format=nv12,hwupload,scale_vaapi=w=${r.w}:h=${r.h}:force_original_aspect_ratio=decrease`,
    '-map', '0:v:0',
  ]
  if (options.includeAudio) {
    args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', r.abr)
  }
  args.push(
    '-c:v', 'h264_vaapi', '-g', '180', '-keyint_min', '180', '-sc_threshold', '0',
    '-b:v', r.br, '-maxrate', r.max, '-bufsize', r.buf,
    '-f', 'mp4',
    outPath,
  )
  await runFfmpeg(args, `encode ${r.out}`, {
    videoId,
    stage: options.stage,
    rendition: key,
    durationSec: videoDurations.get(videoId) ?? null,
    overallBase: options.overallBase,
    overallSpan: options.overallSpan,
    phase: stageToProgressPhase(options.stage),
  })
  emitProgressCheckpoint(videoId, options.stage, options.overallBase + options.overallSpan, `${key} done`, key)
  const finalPath = path.join(tmpDir, r.out)
  await rename(outPath, finalPath)
  return finalPath
}

async function packagePhase1Hls(tmpDir: string, hasAudio: boolean, videoId: string): Promise<void> {
  await mkdir(path.join(tmpDir, '720p'), { recursive: true })
  const shakaArgs = [
    `input=${path.join(tmpDir, '720p.mp4')},stream=video,init_segment=${path.join(tmpDir, '720p/init_720.mp4')},segment_template=${path.join(tmpDir, '720p/seg_720_$Number$.m4s')},playlist_name=720p/playlist.m3u8`,
  ]
  if (hasAudio) {
    shakaArgs.push(
      `input=${path.join(tmpDir, '720p.mp4')},stream=audio,init_segment=${path.join(tmpDir, 'init_audio.mp4')},segment_template=${path.join(tmpDir, 'seg_audio_$Number$.m4s')},playlist_name=${HLS_AUDIO_PLAYLIST}`,
    )
  }
  shakaArgs.push(
    '--segment_duration', '6',
    '--fragment_duration', '6',
    '--hls_master_playlist_output', path.join(tmpDir, 'master.m3u8.shaka'),
  )
  await run('shaka-packager', shakaArgs, 'shaka-packager phase1', { videoId })
  await adoptShakaMasterM3u8(tmpDir, hasAudio, 1)
}

async function packagePhase2Hls(tmpDir: string, hasAudio: boolean, videoId: string): Promise<void> {
  for (const sub of ['1080p', '720p', '480p'] as const) {
    await mkdir(path.join(tmpDir, sub), { recursive: true })
  }
  const shakaArgs = [
    `input=${path.join(tmpDir, '1080p.mp4')},stream=video,init_segment=${path.join(tmpDir, '1080p/init_1080.mp4')},segment_template=${path.join(tmpDir, '1080p/seg_1080_$Number$.m4s')},playlist_name=1080p/playlist.m3u8`,
    `input=${path.join(tmpDir, '720p.mp4')},stream=video,init_segment=${path.join(tmpDir, '720p/init_720.mp4')},segment_template=${path.join(tmpDir, '720p/seg_720_$Number$.m4s')},playlist_name=720p/playlist.m3u8`,
    `input=${path.join(tmpDir, '480p.mp4')},stream=video,init_segment=${path.join(tmpDir, '480p/init_480.mp4')},segment_template=${path.join(tmpDir, '480p/seg_480_$Number$.m4s')},playlist_name=480p/playlist.m3u8`,
  ]
  if (hasAudio) {
    shakaArgs.push(
      `input=${path.join(tmpDir, '720p.mp4')},stream=audio,init_segment=${path.join(tmpDir, 'init_audio.mp4')},segment_template=${path.join(tmpDir, 'seg_audio_$Number$.m4s')},playlist_name=${HLS_AUDIO_PLAYLIST}`,
    )
  }
  shakaArgs.push(
    '--segment_duration', '6',
    '--fragment_duration', '6',
    '--hls_master_playlist_output', path.join(tmpDir, 'master.m3u8.shaka'),
  )
  await run('shaka-packager', shakaArgs, 'shaka-packager phase2', { videoId })
  await adoptShakaMasterM3u8(tmpDir, hasAudio, 2)
}

async function rcloneCopyDir(localDir: string, r2Dest: string, label: string, videoId?: string): Promise<void> {
  await run('rclone', ['copy', localDir, r2Dest, ...rcloneTransferArgs()], label, { videoId })
}

async function rcloneCopyFile(localFile: string, r2Dest: string, label: string, videoId?: string): Promise<void> {
  await run('rclone', ['copyto', localFile, r2Dest, ...rcloneTransferArgs()], label, { videoId })
}

async function rcloneCopySharedAudioAssets(tmpDir: string, r2Base: string, label: string, videoId?: string): Promise<void> {
  const hasInit = existsSync(path.join(tmpDir, 'init_audio.mp4'))
  const hasPlaylist = existsSync(path.join(tmpDir, HLS_AUDIO_PLAYLIST))
  const entries = await readdir(tmpDir)
  const hasSegments = entries.some((f) => /^seg_audio_\d+\.m4s$/.test(f))
  if (!hasInit && !hasPlaylist && !hasSegments) return

  await run('rclone', [
    'copy', tmpDir, r2Base,
    '--max-depth', '1',
    '--include', 'init_audio.mp4',
    '--include', HLS_AUDIO_PLAYLIST,
    '--include', 'seg_audio_*.m4s',
    ...rcloneTransferArgs(),
  ], label, { videoId })
}

async function rcloneCheckDir(localDir: string, r2Dest: string, label: string, videoId?: string): Promise<void> {
  await run('rclone', ['check', localDir, r2Dest, '--one-way', ...rcloneBaseArgs()], label, { videoId })
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

async function phase1EncodeAndPublish(
  videoId: string,
  inputPath: string,
  tmpDir: string,
  hasAudio: boolean,
): Promise<Phase1Result> {
  setJobPhase(videoId, 'phase1')
  await emitTtp(videoId, 'phase1_encode_start', { initialRendition: '720p' })
  emitPipelineEvent(videoId, 'phase1_encode', 'active', '720p')
  const audioTmpPath = await encodeRendition(videoId, inputPath, tmpDir, '720p', {
    includeAudio: hasAudio,
    stage: 'phase1_encode',
    overallBase: PROGRESS.P1_ENCODE.base,
    overallSpan: PROGRESS.P1_ENCODE.span,
  })
  emitPipelineEvent(videoId, 'phase1_encode', 'active', 'done')
  await emitTtp(videoId, 'phase1_encode_done', { initialRendition: '720p' })

  emitPipelineEvent(videoId, 'phase1_encode', 'active', 'packaging_hls')
  await packagePhase1Hls(tmpDir, hasAudio, videoId)
  emitProgressCheckpoint(videoId, 'phase1_encode', PROGRESS.P1_DONE - 0.02, 'packaged')

  setJobPhase(videoId, 'upload')
  emitPipelineEvent(videoId, 'phase1_upload', 'active', 'start')
  await emitTtp(videoId, 'phase1_upload_start', {})
  const r2Base = r2Path(`videos/${videoId}`)
  await rcloneCopyDir(path.join(tmpDir, '720p'), `${r2Base}/720p`, 'rclone upload 720p phase1', videoId)
  if (hasAudio) {
    await rcloneCopySharedAudioAssets(tmpDir, r2Base, 'rclone upload shared audio phase1', videoId)
  }
  await rcloneCheckDir(path.join(tmpDir, '720p'), `${r2Base}/720p`, 'rclone check 720p phase1', videoId)
  await rcloneCopyFile(path.join(tmpDir, 'master.m3u8'), `${r2Base}/master.m3u8`, 'rclone upload master phase1', videoId)
  emitPipelineEvent(videoId, 'phase1_upload', 'active', 'done')
  await emitTtp(videoId, 'phase1_upload_done', {})
  emitProgressCheckpoint(videoId, 'phase1_upload', PROGRESS.P1_DONE, '720p on R2')

  await notifyVideoAvailable(videoId, 'preview_ready', ['720p'])
  emitPipelineEvent(videoId, 'phase1_available', 'success', 'preview_ready')
  await emitTtp(videoId, 'minimal_publish_ready', { renditionsOnR2: ['720p'], masterManifest: `videos/${videoId}/master.m3u8` })

  return { audioTmpPath: hasAudio ? audioTmpPath : null, hasAudio }
}

async function phase2RemainingRenditions(
  videoId: string,
  inputPath: string,
  tmpDir: string,
  hasAudio: boolean,
): Promise<void> {
  setJobPhase(videoId, 'phase2')
  await emitTtp(videoId, 'phase2_encode_start', { renditions: ['1080p', '480p'] })
  emitPipelineEvent(videoId, 'phase2_encode', 'active', '1080p+480p')
  await encodeRendition(videoId, inputPath, tmpDir, '1080p', {
    includeAudio: false,
    stage: 'phase2_encode',
    overallBase: PROGRESS.P2_1080.base,
    overallSpan: PROGRESS.P2_1080.span,
  })
  await encodeRendition(videoId, inputPath, tmpDir, '480p', {
    includeAudio: false,
    stage: 'phase2_encode',
    overallBase: PROGRESS.P2_480.base,
    overallSpan: PROGRESS.P2_480.span,
  })
  emitPipelineEvent(videoId, 'phase2_encode', 'active', 'done')
  await emitTtp(videoId, 'phase2_encode_done', {})

  emitPipelineEvent(videoId, 'phase2_package', 'active', 'start')
  await packagePhase2Hls(tmpDir, hasAudio, videoId)
  emitProgressCheckpoint(videoId, 'phase2_package', PROGRESS.P2_PACKAGE.base + PROGRESS.P2_PACKAGE.span, 'packaged')
  emitPipelineEvent(videoId, 'phase2_package', 'active', 'done')

  setJobPhase(videoId, 'upload')
  emitPipelineEvent(videoId, 'phase2_upload', 'active', 'start')
  await emitTtp(videoId, 'phase2_upload_start', {})
  const r2Base = r2Path(`videos/${videoId}`)
  await rcloneCopyDir(path.join(tmpDir, '1080p'), `${r2Base}/1080p`, 'rclone upload 1080p phase2', videoId)
  emitProgressCheckpoint(videoId, 'phase2_upload', PROGRESS.P2_UPLOAD.base + PROGRESS.P2_UPLOAD.span * 0.25, '1080p uploading')
  await rcloneCopyDir(path.join(tmpDir, '480p'), `${r2Base}/480p`, 'rclone upload 480p phase2', videoId)
  await rcloneCopyDir(path.join(tmpDir, '720p'), `${r2Base}/720p`, 'rclone upload 720p phase2', videoId)
  await rcloneCheckDir(path.join(tmpDir, '1080p'), `${r2Base}/1080p`, 'rclone check 1080p phase2', videoId)
  await rcloneCheckDir(path.join(tmpDir, '480p'), `${r2Base}/480p`, 'rclone check 480p phase2', videoId)
  await rcloneCheckDir(path.join(tmpDir, '720p'), `${r2Base}/720p`, 'rclone check 720p phase2', videoId)
  if (hasAudio) {
    await rcloneCopySharedAudioAssets(tmpDir, r2Base, 'rclone upload shared audio phase2', videoId)
  }

  emitPipelineEvent(videoId, 'phase2_manifest_swap', 'active', 'upload_master')
  await rcloneCopyFile(path.join(tmpDir, 'master.m3u8'), `${r2Base}/master.m3u8`, 'rclone upload master phase2', videoId)
  emitPipelineEvent(videoId, 'phase2_upload', 'active', 'done')
  await emitTtp(videoId, 'phase2_upload_done', {})
  emitProgressCheckpoint(videoId, 'phase2_upload', PROGRESS.P2_DONE, 'all renditions on R2')

  await notifyVideoAvailable(videoId, 'fully_processed', ['1080p', '720p', '480p'])
  emitPipelineEvent(videoId, 'multi_rendition_ready', 'success', 'fully_processed')
  await emitTtp(videoId, 'full_renditions_ready', { renditionsOnR2: ['1080p', '720p', '480p'] })
}

async function encodePodcastMp3(videoId: string, inputPath: string, tmpDir: string): Promise<void> {
  setJobPhase(videoId, 'podcast')
  emitPipelineEvent(videoId, 'podcast_mp3', 'active', 'start')
  const mp3Tmp = path.join(tmpDir, `podcast.mp3.tmp.${process.pid}`)
  await runFfmpeg(
    ['-hide_banner', '-y', '-i', inputPath, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-f', 'mp3', mp3Tmp],
    'encode podcast mp3',
    {
      videoId,
      stage: 'podcast_mp3',
      rendition: 'mp3',
      durationSec: videoDurations.get(videoId) ?? null,
      overallBase: PROGRESS.PODCAST.base,
      overallSpan: PROGRESS.PODCAST.span,
      phase: 'podcast',
    },
  )
  await rename(mp3Tmp, path.join(tmpDir, 'podcast.mp3'))
  setJobPhase(videoId, 'upload')
  await run('rclone', ['copyto', path.join(tmpDir, 'podcast.mp3'), r2Path(`videos/${videoId}/podcast.mp3`)], 'upload podcast mp3', { videoId })
  emitPipelineEvent(videoId, 'podcast_mp3', 'active', 'done')
  emitProgressCheckpoint(videoId, 'podcast_mp3', PROGRESS.PODCAST.base + PROGRESS.PODCAST.span, 'podcast.mp3 on R2', 'mp3')
}

async function processVideo(videoId: string, inputPath: string, source = 'watchfolder'): Promise<void> {
  const jobStartMs = Date.now()
  increment('vmp.transcoder.job.started', 1, { source })
  const tmpDir = path.join(TMP_DIR_BASE, videoId)
  const doneFlag = path.join(tmpDir, '.done')
  const lockFile = path.join(tmpDir, '.lock')
  let cancelled = false
  if (isJobStopped(videoId)) return
  await mkdir(tmpDir, { recursive: true })
  if (existsSync(doneFlag)) {
    emitPipelineEvent(videoId, 'done', 'success', 'already_done')
    return
  }
  if (existsSync(lockFile)) {
    emitPipelineEvent(videoId, 'deduped', 'active', 'already_processing')
    return
  }
  await writeFile(lockFile, String(process.pid))
  jobInputPaths.set(videoId, inputPath)
  ensureJobHandle(videoId, 'phase1')
  await emitTtp(videoId, 'processing_started', {})
  emitPipelineEvent(videoId, 'detected', 'active', `source=${source}`)
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

    await phase1EncodeAndPublish(videoId, inputPath, tmpDir, hasAudio)
    assertNotStopped(videoId)
    await waitWhilePaused(videoId)
    emitPipelineEvent(videoId, 'phase1_available', 'active', 'preview_ready')

    const podcastTask = hasAudio
      ? encodePodcastMp3(videoId, inputPath, tmpDir)
        .then(() => emitTtp(videoId, 'podcast_mp3_done', {}))
        .catch(async (err) => {
          if (isJobStopped(videoId)) throw new JobStoppedError(videoId)
          const detail = err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220)
          log(`⚠️ ${videoId}: podcast MP3 failed (video still watchable at 720p): ${err instanceof Error ? err.message : String(err)}`)
          emitPipelineEvent(videoId, 'podcast_mp3', 'failed', detail)
          await emitTtp(videoId, 'podcast_mp3_failed', { error: detail })
        })
      : (async () => {
        emitPipelineEvent(videoId, 'podcast_mp3', 'active', 'skipped_no_audio')
        await emitTtp(videoId, 'podcast_mp3_skipped', {})
      })()

    const phase2Task = phase2RemainingRenditions(videoId, inputPath, tmpDir, hasAudio).catch((err) => {
      if (isJobStopped(videoId)) throw new JobStoppedError(videoId)
      log(`⚠️ ${videoId}: phase2 failed (720p HLS remains available): ${err instanceof Error ? err.message : String(err)}`)
      emitPipelineEvent(videoId, 'phase2_upload', 'failed', err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220))
    })

    await Promise.all([podcastTask, phase2Task])
    assertNotStopped(videoId)
    await waitWhilePaused(videoId)

    if (PREVIEW_MP3_ENABLED && hasAudio && existsSync(path.join(tmpDir, 'podcast.mp3'))) {
      setJobPhase(videoId, 'preview')
      assertNotStopped(videoId)
      await waitWhilePaused(videoId)
      if (PREVIEW_MP3_LOCK_SECONDS > 0) {
        emitPipelineEvent(videoId, 'preview_wait', 'active', `${PREVIEW_MP3_LOCK_SECONDS}s`)
        await new Promise((r) => setTimeout(r, PREVIEW_MP3_LOCK_SECONDS * 1000))
      }
      emitPipelineEvent(videoId, 'preview_render', 'active', `${PREVIEW_MP3_SECONDS}s`)
      const prevTmp = path.join(tmpDir, `podcast_preview.mp3.tmp.${process.pid}`)
      await runFfmpeg(
        ['-hide_banner', '-y', '-i', path.join(tmpDir, 'podcast.mp3'), '-t', String(PREVIEW_MP3_SECONDS), '-vn', '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-f', 'mp3', prevTmp],
        'encode preview mp3',
        {
          videoId,
          stage: 'preview_render',
          rendition: 'preview_mp3',
          durationSec: PREVIEW_MP3_SECONDS,
          overallBase: PROGRESS.PREVIEW.base,
          overallSpan: PROGRESS.PREVIEW.span,
          phase: 'preview',
        },
      )
      await rename(prevTmp, path.join(tmpDir, 'podcast_preview.mp3'))
      const probe = await run(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(tmpDir, 'podcast_preview.mp3')],
        'probe preview mp3 duration',
        { capture: true, videoId },
      )
      const measuredDurationSeconds = Math.round(Number.parseFloat((probe.stdout || '').trim()))
      if (Number.isFinite(measuredDurationSeconds) && measuredDurationSeconds > 0) {
        await writeFile(
          path.join(tmpDir, 'podcast_preview.meta.json'),
          JSON.stringify({
            videoId,
            requestedPreviewSeconds: PREVIEW_MP3_SECONDS,
            measuredDurationSeconds,
            renderedAt: new Date().toISOString(),
          }),
        )
      }
      setJobPhase(videoId, 'upload')
      emitPipelineEvent(videoId, 'preview_upload', 'active', 'start')
      await run('rclone', ['copyto', path.join(tmpDir, 'podcast_preview.mp3'), r2Path(`videos/${videoId}/podcast_preview.mp3`)], 'upload preview mp3', { videoId })
      if (existsSync(path.join(tmpDir, 'podcast_preview.meta.json'))) {
        await run('rclone', ['copyto', path.join(tmpDir, 'podcast_preview.meta.json'), r2Path(`videos/${videoId}/podcast_preview.meta.json`)], 'upload preview mp3 metadata', { videoId })
      }
      emitPipelineEvent(videoId, 'preview_upload', 'active', 'done')
      emitProgressCheckpoint(videoId, 'preview_upload', PROGRESS.PREVIEW.base + PROGRESS.PREVIEW.span, 'preview on R2', 'preview_mp3')
      await emitTtp(videoId, 'preview_mp3_done', { previewSeconds: PREVIEW_MP3_SECONDS })
    } else {
      emitPipelineEvent(videoId, 'preview_render', 'active', 'skipped')
      await emitTtp(videoId, 'preview_mp3_skipped', {})
    }

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
    throw err
  } finally {
    if (cancelled) {
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

function maybeEnqueueOnce(videoId: string, inputPath: string, source: string): void {
  if (enqueuedVideoIds.has(videoId)) return
  enqueuedVideoIds.add(videoId)
  enqueue(videoId, inputPath, source)
}

function scheduleInboxIntake(file: string, source: string): void {
  inboxIntakeChain = inboxIntakeChain
    .then(() => intakeInboxBasename(file, source))
    .catch((err) => {
      log(`inbox intake failed for '${file}' (${source}): ${err instanceof Error ? err.message : String(err)}`)
    })
}

async function intakeInboxBasename(file: string, source: string): Promise<void> {
  if (!isInboxVideoBasename(file)) return

  const cachedByFile = inboxIntakeByBasename.get(file)
  if (cachedByFile) {
    maybeEnqueueOnce(cachedByFile.videoId, cachedByFile.targetPath, source)
    return
  }

  const stem = file.replace(/\.[^.]+$/, '')
  const ext = file.split('.').pop() || 'mp4'
  const oldPath = path.join(INBOX_DIR, file)

  if (isUuidLike(stem) && enqueuedVideoIds.has(stem)) return

  const cachedByStem = inboxResolvedByOriginalStem.get(stem)
  if (cachedByStem && existsSync(cachedByStem.targetPath)) {
    inboxIntakeByBasename.set(file, cachedByStem)
    maybeEnqueueOnce(cachedByStem.videoId, cachedByStem.targetPath, source)
    return
  }

  if (!existsSync(oldPath)) return

  const result = await resolveInputTargetPath(stem, ext, oldPath, source)
  inboxIntakeByBasename.set(file, result)
  if (!isUuidLike(stem) || result.renamed) {
    inboxResolvedByOriginalStem.set(stem, result)
  }
  if (result.renamed) {
    const detail = result.reason === 'random_uuid' ? 'Generated random VIDEO_ID' : 'Sanitized VIDEO_ID'
    log(`🧼 ${detail} ${source}: '${stem}' -> '${result.videoId}'`)
  }
  maybeEnqueueOnce(result.videoId, result.targetPath, source)
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

function enqueue(videoId: string, inputPath: string, source: string): void {
  if (isJobStopped(videoId)) return
  beginTtpJob(videoId, source, inputPath)
  queue.push({ videoId, inputPath, source })
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
    processVideo(job.videoId, job.inputPath, job.source)
      .catch(() => {})
      .finally(() => {
        running -= 1
        reportQueueMetrics()
        drain()
      })
  }
}

async function startupScan(): Promise<void> {
  await mkdir(INBOX_DIR, { recursive: true })
  await mkdir(TMP_DIR_BASE, { recursive: true })
  const entries = await readdir(INBOX_DIR)
  for (const file of entries) {
    await intakeInboxBasename(file, 'startup_scan')
  }
}

function startWatcher() {
  const child = trackChild(spawn('inotifywait', ['-m', '-e', 'close_write', '--format', '%f', INBOX_DIR], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] }))
  let stdoutBuffer = ''
  const processLines = (lines: string[]): void => {
    const unique = [...new Set(lines.filter(Boolean))]
    for (const file of unique) {
      scheduleInboxIntake(file, 'watchfolder')
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
      log(`inotifywait exited unexpectedly with code=${code ?? 'null'}`)
      process.exit(1)
    }
  })
  return child
}

function startPollingWatcher() {
  let timer: NodeJS.Timeout | null = null
  let known = new Set<string>()
  const poll = async () => {
    if (shuttingDown) return
    try {
      const entries = await readdir(INBOX_DIR)
      const current = new Set(entries)
      for (const file of entries) {
        if (known.has(file)) continue
        if (!isInboxVideoBasename(file)) continue
        scheduleInboxIntake(file, 'polling_watchfolder')
      }
      known = current
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
  if (!existsSync(VAAPI_DEVICE)) {
    throw new Error(`VAAPI device not found: ${VAAPI_DEVICE}`)
  }
  log(`☁️  Using R2 root: ${r2Root()}`)
  log('🔍 Resuming existing jobs...')
  await startupScan()
  log('🎬 Watching for new uploads...')
  let watcher: { kill: (signal?: NodeJS.Signals) => boolean } | null = null
  let poller: { stop: () => void } | null = null
  try {
    watcher = startWatcher()
    log('✅ inotify watcher started')
  } catch (err) {
    log(`⚠️ inotify unavailable, falling back to polling: ${err instanceof Error ? err.message : String(err)}`)
    poller = startPollingWatcher()
  }

  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    if (watcher) watcher.kill('SIGTERM')
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
