#!/usr/bin/env node
/**
 * VMP media host supervisor: runs pipeline_watch.js, serves local dashboard + webhook API.
 *
 * Environment:
 *   VMP_WEBHOOK_SECRET     — HMAC secret (same as admin_settings); required unless VMP_REQUIRE_WEBHOOK_SECRET=0
 *   VMP_UI_HOST            — default 127.0.0.1
 *   VMP_UI_PORT            — default 8788
 *   VMP_PIPELINE_SCRIPT    — default: pipeline_watch.js next to this file
 *   VMP_RENDER_SCRIPT      — path to render script; default: render_podcast_preview_mp3.js next to this file
 *   VMP_RUN_PIPELINE       — default 1; set 0 to only run UI + preview jobs (no watchfolder)
 *   VMP_PREVIEW_CONCURRENCY — max concurrent preview encodes (default 1)
 *
 * Systemd: one unit runs this process; it spawns the Node pipeline watcher as a child.
 */

import http from 'node:http'
import crypto from 'node:crypto'
import net from 'node:net'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = __dirname

const pipelineScript = process.env.VMP_PIPELINE_SCRIPT || path.join(pkgRoot, 'pipeline_watch.js')
const renderScript = process.env.VMP_RENDER_SCRIPT || path.join(pkgRoot, 'render_podcast_preview_mp3.js')

const requireWebhookSecret = process.env.VMP_REQUIRE_WEBHOOK_SECRET !== '0'
const secret = process.env.VMP_WEBHOOK_SECRET?.trim()
if (requireWebhookSecret && !secret) {
  console.error('[vmp-podcast-host] Set VMP_WEBHOOK_SECRET or VMP_REQUIRE_WEBHOOK_SECRET=0')
  process.exit(1)
}

const uiHost = process.env.VMP_UI_HOST || '127.0.0.1'
const uiPort = Number.parseInt(process.env.VMP_UI_PORT || '8788', 10)
const runPipeline = process.env.VMP_RUN_PIPELINE !== '0'
const MAX_GPU_JOBS = Math.max(1, Number.parseInt(process.env.VMP_GPU_CONCURRENCY || '1', 10) || 1)
const MAX_UPLOAD_JOBS = Math.max(1, Number.parseInt(process.env.VMP_UPLOAD_CONCURRENCY || '2', 10) || 2)
const STUCK_JOB_MINUTES = Math.max(1, Number.parseInt(process.env.VMP_STUCK_JOB_MINUTES || '60', 10) || 60)
const gpuSlots = { max: MAX_GPU_JOBS, current: 0 }
const uploadSlots = { max: MAX_UPLOAD_JOBS, current: 0 }
let previewGpuRunning = 0
const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10 MB
const autoUpgradeEnabled = process.env.VMP_AUTO_UPGRADE === '1'
const autoUpgradeBranch = process.env.VMP_AUTO_UPGRADE_BRANCH || 'main'
const autoUpgradeRepoDir = process.env.VMP_AUTO_UPGRADE_REPO_DIR || '/workspace'
const autoUpgradePath = process.env.VMP_AUTO_UPGRADE_PATH || 'packages/podcast-host'
const autoUpgradeCheckMs = Math.max(60_000, Number.parseInt(process.env.VMP_AUTO_UPGRADE_CHECK_MS || '300000', 10) || 300000)

function validateScriptPath(rawPath, label, envVarName, defaultScriptName) {
  const resolved = path.resolve(rawPath)
  const basename = path.basename(resolved)
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `${label} script not found at ${resolved}. ` +
      `Update ${envVarName} to a valid .js script path.`
    )
  }
  if (basename.endsWith('.sh')) {
    throw new Error(
      `${label} script points to deprecated shell script ${resolved}. ` +
      `Use the Node script (${defaultScriptName}) instead.`
    )
  }
  if (basename.endsWith('.ts')) {
    const distDir = path.join(path.dirname(resolved), 'dist')
    throw new Error(
      `${label} script points to TypeScript source ${resolved}. ` +
      `Node imports use .js paths (e.g. ttpLog.js) that exist only in dist/ after build. ` +
      `Run \`npm run build --workspace=@vmp/podcast-host\`, then set ${envVarName} to ` +
      `${path.join(distDir, defaultScriptName)} or remove the override.`
    )
  }
  return resolved
}

/** Ensure compiled pipeline_watch.js sibling imports (e.g. ttpLog.js) exist after git pull. */
function validatePipelineBundle(resolvedPipelineScript) {
  const dir = path.dirname(resolvedPipelineScript)
  const content = fs.readFileSync(resolvedPipelineScript, 'utf8')
  const importRe = /from\s+['"]\.\/([^'"]+\.js)['"]/g
  const missing = []
  for (const match of content.matchAll(importRe)) {
    const depPath = path.join(dir, match[1])
    if (!fs.existsSync(depPath)) missing.push(match[1])
  }
  if (missing.length === 0) return
  throw new Error(
    `Pipeline script ${resolvedPipelineScript} imports missing module(s): ${missing.join(', ')}. ` +
    'dist/ is not committed — run `npm run build --workspace=@vmp/podcast-host` after pulling changes.',
  )
}

let resolvedPipelineScript = pipelineScript
let resolvedRenderScript = renderScript
try {
  resolvedPipelineScript = validateScriptPath(pipelineScript, 'Pipeline', 'VMP_PIPELINE_SCRIPT', 'pipeline_watch.js')
  validatePipelineBundle(resolvedPipelineScript)
  resolvedRenderScript = validateScriptPath(renderScript, 'Render', 'VMP_RENDER_SCRIPT', 'render_podcast_preview_mp3.js')
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[vmp-podcast-host] ${message}`)
  console.error('[vmp-podcast-host] Migration note: legacy .sh scripts were removed; update env overrides to the new .js entrypoints.')
  process.exit(1)
}

type QueuedJob = {
  id: string
  type: 'pipeline' | 'preview_mp3'
  videoId: string
  priority: number
  enqueuedAt: string
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'stopped'
  detail?: string
  source?: string
  previewSeconds?: number
}

/** @type {QueuedJob[]} */
const jobQueue: QueuedJob[] = []
/** @type {Map<string, QueuedJob>} */
const jobsById = new Map<string, QueuedJob>()
/** @type {Map<string, QueuedJob>} */
const jobsByVideoId = new Map<string, QueuedJob>()
/** @type {Map<string, { id: string, type: string, videoId: string, source: string, stage: string, status: string, detail?: string, startedAt: string, updatedAt: string, finishedAt?: string }>} */
const pipelineActiveJobs = new Map()
/** @type {{ id: string, type: string, videoId: string, source: string, stage: string, status: string, detail?: string, startedAt: string, updatedAt: string, finishedAt: string }[]} */
const pipelineSuccessfulJobs = []
const MAX_PIPELINE_SUCCESS_JOBS = 400
/** @type {{ id: string, type: string, videoId: string, source: string, stage: string, status: string, detail?: string, startedAt: string, updatedAt: string, finishedAt: string }[]} */
const failedPipelineJobs = []
const MAX_PIPELINE_FAILED_JOBS = 200
/** @type {string[]} */
const logLines = []
const MAX_LOG = 400
/** @type {{ videoId: string, minimalMs: number|null, fullMs: number|null, totalMs: number, minimalRatio: number|null, fullRatio: number|null, at: string }[]} */
const ttpSummaries = []
const MAX_TTP_SUMMARIES = 50

function pushLog(line) {
  const ts = new Date().toISOString()
  const s = `[${ts}] ${line}`
  console.log(s)
  logLines.push(s)
  while (logLines.length > MAX_LOG) logLines.shift()
}

function stageLabel(stage) {
  const labels = {
    detected: 'Detected in watchfolder',
    deduped: 'Already processing',
    wait_upload_complete: 'Waiting for file settle',
    probe: 'Probe source',
    phase1_encode: 'Phase 1: encode & package 720p',
    phase1_upload: 'Phase 1: upload 720p to R2',
    phase1_available: 'Phase 1: 720p watchable',
    phase2_encode: 'Phase 2: encode 1080p & 480p',
    phase2_package: 'Phase 2: package multi-rendition HLS',
    phase2_upload: 'Phase 2: upload renditions to R2',
    phase2_manifest_swap: 'Phase 2: swap master manifest',
    multi_rendition_ready: 'All renditions ready',
    encode: 'Re-encoding renditions',
    podcast_mp3: 'Encoding podcast MP3',
    package_hls: 'Packaging HLS',
    upload_assets: 'Uploading assets to R2',
    preview_wait: 'Waiting preview lock',
    preview_render: 'Encoding preview MP3',
    preview_upload: 'Uploading preview MP3',
    cleanup: 'Cleanup',
    done: 'Done',
    failed: 'Failed',
    paused: 'Paused',
    resumed: 'Resumed',
    stopped: 'Stopped',
  }
  return labels[stage] || stage
}

function sortJobQueue(): void {
  jobQueue.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.enqueuedAt < b.enqueuedAt ? -1 : a.enqueuedAt > b.enqueuedAt ? 1 : 0
  })
}

function registerQueuedJob(job: QueuedJob): void {
  jobsById.set(job.id, job)
  jobsByVideoId.set(job.videoId, job)
  const existingIdx = jobQueue.findIndex((q) => q.id === job.id)
  if (existingIdx >= 0) jobQueue[existingIdx] = job
  else jobQueue.push(job)
  sortJobQueue()
  while (jobQueue.length > 200) {
    const removed = jobQueue.pop()
    if (removed) jobsById.delete(removed.id)
  }
}

function getQueuePosition(videoId: string): number | null {
  const idx = jobQueue.findIndex((j) => j.videoId === videoId && j.status === 'queued')
  return idx >= 0 ? idx + 1 : null
}

function isEncodeStage(stage: string): boolean {
  return /encode|podcast_mp3|preview_render|probe/.test(stage)
}

function isUploadStage(stage: string): boolean {
  return /upload/.test(stage)
}

function syncResourceSlots(): void {
  let gpu = previewGpuRunning
  let upload = 0
  for (const job of pipelineActiveJobs.values()) {
    if (job.status === 'paused') continue
    const stage = String(job.stage || '')
    if (isEncodeStage(stage)) gpu += 1
    if (isUploadStage(stage)) upload += 1
  }
  gpuSlots.current = gpu
  uploadSlots.current = upload
}

function phaseProgressFromOverall(overall: number | null) {
  if (overall == null || !Number.isFinite(overall)) {
    return { phase1Pct: null, phase2Pct: null, phase2Started: false }
  }
  const clamped = Math.max(0, Math.min(1, overall))
  const phase1Pct = Math.min(1, clamped / 0.30)
  const phase2Started = clamped > 0.30
  const phase2Pct = phase2Started ? Math.min(1, (clamped - 0.30) / 0.50) : 0
  return { phase1Pct, phase2Pct, phase2Started }
}

function upsertPipelineJob(event) {
  const now = new Date().toISOString()
  const existing = pipelineActiveJobs.get(event.videoId)
  const startedAt = existing?.startedAt || now
  const row = {
    id: existing?.id || crypto.randomUUID(),
    type: 'pipeline',
    videoId: event.videoId,
    source: existing?.source || event.source || 'watchfolder',
    stage: event.stage,
    status: event.status,
    detail: event.detail,
    startedAt,
    updatedAt: now,
    finishedAt: undefined,
    progressOverall: existing?.progressOverall ?? null,
    progressStage: existing?.progressStage ?? event.stage,
    progressRendition: existing?.progressRendition ?? '',
    progressStagePct: existing?.progressStagePct ?? null,
    progressSpeed: existing?.progressSpeed ?? null,
    progressEtaSec: existing?.progressEtaSec ?? null,
    progressPhase: existing?.progressPhase ?? '',
    progressPhase1Pct: existing?.progressPhase1Pct ?? null,
    progressPhase2Pct: existing?.progressPhase2Pct ?? null,
    progressPhase2Started: existing?.progressPhase2Started ?? false,
    priority: existing?.priority ?? 100,
    queuePosition: null,
  }
  let queued = jobsByVideoId.get(event.videoId)
  if (!queued && event.stage === 'detected') {
    queued = {
      id: row.id,
      type: 'pipeline',
      videoId: event.videoId,
      priority: 100,
      enqueuedAt: now,
      status: 'running',
      detail: event.detail,
      source: row.source,
    }
    registerQueuedJob(queued)
  }
  if (queued) {
    row.priority = queued.priority
    if (event.stage === 'paused' || event.status === 'paused') queued.status = 'paused'
    else if (event.stage === 'resumed') queued.status = 'running'
    else if (event.stage === 'stopped' || event.detail === 'stopped_by_user') queued.status = 'stopped'
    else if (event.stage === 'done' && event.status === 'success') queued.status = 'done'
    else if (event.stage === 'failed' || event.status === 'failed') queued.status = 'failed'
    else if (!['done', 'failed', 'stopped'].includes(queued.status)) queued.status = 'running'
    registerQueuedJob(queued)
  }
  if (event.stage === 'done' && event.status === 'success') {
    pipelineActiveJobs.delete(event.videoId)
    const doneRow = { ...row, finishedAt: now }
    pipelineSuccessfulJobs.unshift(doneRow)
    while (pipelineSuccessfulJobs.length > MAX_PIPELINE_SUCCESS_JOBS) pipelineSuccessfulJobs.pop()
    syncResourceSlots()
    return
  }
  if (event.stage === 'failed' || event.status === 'failed' || event.stage === 'stopped') {
    row.finishedAt = now
    pipelineActiveJobs.delete(event.videoId)
    failedPipelineJobs.unshift(row)
    while (failedPipelineJobs.length > MAX_PIPELINE_FAILED_JOBS) failedPipelineJobs.pop()
    syncResourceSlots()
    return
  }
  row.queuePosition = getQueuePosition(event.videoId)
  pipelineActiveJobs.set(event.videoId, row)
  syncResourceSlots()
}

function consumeTtpLine(line) {
  if (!line.startsWith('VMP_TTP\t')) return false
  try {
    const row = JSON.parse(line.slice('VMP_TTP\t'.length))
    if (row.type !== 'ttp_summary') return true
    ttpSummaries.unshift({
      videoId: String(row.videoId || ''),
      minimalMs: row.minimalPublishReadyElapsedMs ?? null,
      fullMs: row.fullRenditionsReadyElapsedMs ?? null,
      totalMs: row.totalElapsedMs ?? 0,
      minimalRatio: row.minimalPublishReadyRatioOfSourceDuration ?? null,
      fullRatio: row.fullRenditionsReadyRatioOfSourceDuration ?? null,
      at: String(row.at || new Date().toISOString()),
    })
    while (ttpSummaries.length > MAX_TTP_SUMMARIES) ttpSummaries.pop()
  } catch {
    // ignore malformed TTP JSON
  }
  return true
}

function consumePipelineProgressLine(line) {
  if (!line.startsWith('VMP_PIPELINE_PROGRESS\t')) return false
  try {
    const row = JSON.parse(line.slice('VMP_PIPELINE_PROGRESS\t'.length))
    const videoId = String(row.videoId || '')
    if (!videoId) return true
    const existing = pipelineActiveJobs.get(videoId)
    const now = new Date().toISOString()
    const base = existing || {
      id: crypto.randomUUID(),
      type: 'pipeline',
      videoId,
      source: 'watchfolder',
      stage: String(row.stage || 'detected'),
      status: 'active',
      detail: '',
      startedAt: now,
      updatedAt: now,
    }
    const phaseProgress = phaseProgressFromOverall(
      typeof row.overallProgress === 'number' ? row.overallProgress : base.progressOverall,
    )
    pipelineActiveJobs.set(videoId, {
      ...base,
      stage: String(row.stage || base.stage),
      progressOverall: typeof row.overallProgress === 'number' ? row.overallProgress : base.progressOverall,
      progressStage: String(row.stage || base.progressStage || ''),
      progressRendition: String(row.rendition || base.progressRendition || ''),
      progressStagePct: typeof row.stageProgress === 'number' ? row.stageProgress : base.progressStagePct,
      progressSpeed: typeof row.speed === 'number' ? row.speed : base.progressSpeed,
      progressEtaSec: typeof row.etaSec === 'number' ? row.etaSec : base.progressEtaSec,
      progressPhase: String(row.phase || base.progressPhase || ''),
      progressPhase1Pct: phaseProgress.phase1Pct,
      progressPhase2Pct: phaseProgress.phase2Pct,
      progressPhase2Started: phaseProgress.phase2Started,
      detail: row.detail ? String(row.detail) : base.detail,
      updatedAt: now,
      priority: jobsByVideoId.get(videoId)?.priority ?? 100,
      queuePosition: getQueuePosition(videoId),
    })
    syncResourceSlots()
  } catch {
    // ignore malformed progress JSON
  }
  return true
}

function consumePipelineLine(line) {
  if (!line.startsWith('VMP_PIPELINE_EVENT\t')) return false
  const parts = line.split('\t', 5)
  if (parts.length < 4) return false
  const [, videoId, stage, status, detailRaw] = parts
  if (!videoId || !stage || !status) return false
  const detail = detailRaw || ''
  const sourceMatch = detail.match(/(?:^|\s)source=([a-zA-Z0-9_.-]+)/)
  upsertPipelineJob({
    videoId,
    stage,
    status,
    detail,
    source: sourceMatch ? sourceMatch[1] : undefined,
  })
  return true
}

/** @type {{ pid: number|null, startedAt: string|null, exited: boolean, code: number|null, signal: string|null }} */
const pipelineState = {
  pid: null,
  startedAt: null,
  exited: false,
  code: null,
  signal: null,
}

let pipelineChild = null
let pipelineIpcPath: string | null = null
let pipelineRestartTimer: ReturnType<typeof setTimeout> | null = null

function sendPipelineCommand(
  cmd: 'pause' | 'resume' | 'stop' | 'reorder',
  videoId?: string,
  payload?: { order?: string[] },
): Promise<{ ok: boolean, error?: string }> {
  return new Promise((resolve) => {
    if (!pipelineIpcPath) {
      resolve({ ok: false, error: 'ipc_not_ready' })
      return
    }
    const client = net.createConnection(pipelineIpcPath)
    const message = JSON.stringify({ cmd, videoId, payload })
    let response = ''
    const finish = (result: { ok: boolean, error?: string }) => {
      try { client.destroy() } catch {}
      resolve(result)
    }
    client.setTimeout(10_000, () => finish({ ok: false, error: 'timeout' }))
    client.on('connect', () => client.write(message))
    client.on('data', (d) => { response += d.toString() })
    client.on('end', () => {
      try {
        finish(JSON.parse(response) as { ok: boolean, error?: string })
      } catch {
        finish({ ok: false, error: 'invalid_response' })
      }
    })
    client.on('error', (err) => finish({ ok: false, error: err.message }))
  })
}

function consumeIpcSocketLine(line: string): boolean {
  if (!line.startsWith('VMP_IPC_SOCKET\t')) return false
  pipelineIpcPath = line.slice('VMP_IPC_SOCKET\t'.length).trim() || null
  pushLog(`Pipeline IPC socket: ${pipelineIpcPath ?? '—'}`)
  return true
}

function markRunningJobsFailedOnPipelineCrash(): void {
  const now = new Date().toISOString()
  for (const job of jobsById.values()) {
    if (job.status === 'running' && job.type === 'pipeline') {
      job.status = 'failed'
      job.detail = 'pipeline_restarted'
      registerQueuedJob(job)
    }
  }
  for (const [videoId, row] of pipelineActiveJobs.entries()) {
    const failedRow = {
      ...row,
      stage: 'failed',
      status: 'failed',
      detail: 'pipeline_restarted',
      finishedAt: now,
    }
    pipelineActiveJobs.delete(videoId)
    failedPipelineJobs.unshift(failedRow)
    while (failedPipelineJobs.length > MAX_PIPELINE_FAILED_JOBS) failedPipelineJobs.pop()
  }
  syncResourceSlots()
}

function startPipeline() {
  if (!runPipeline) {
    pushLog('Pipeline disabled (VMP_RUN_PIPELINE=0)')
    return
  }
  pipelineChild = spawn(process.execPath, [resolvedPipelineScript], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  pipelineState.pid = pipelineChild.pid ?? null
  pipelineState.startedAt = new Date().toISOString()
  pipelineState.exited = false
  pipelineState.code = null
  pipelineState.signal = null
  pushLog(`Started pipeline pid=${pipelineState.pid} (${resolvedPipelineScript})`)

  let stdoutBuffer = ''
  let stderrBuffer = ''

  const processBuffer = (buffer, isStdout) => {
    const lines = buffer.split(/\r?\n/)
    const completeLines = lines.slice(0, -1)
    const partialLine = lines[lines.length - 1]

    for (const line of completeLines) {
      if (!line.trim()) continue
      if (consumeTtpLine(line)) continue
      if (consumeIpcSocketLine(line)) continue
      if (consumePipelineProgressLine(line)) continue
      if (consumePipelineLine(line)) continue
      pushLog(`[pipeline] ${line}`)
    }

    return partialLine
  }

  pipelineChild.stdout?.on('data', (d) => {
    stdoutBuffer += d.toString()
    stdoutBuffer = processBuffer(stdoutBuffer, true)
  })

  pipelineChild.stderr?.on('data', (d) => {
    stderrBuffer += d.toString()
    stderrBuffer = processBuffer(stderrBuffer, false)
  })

  const flushBuffers = () => {
    if (stdoutBuffer.trim()) {
      if (consumeTtpLine(stdoutBuffer) || consumeIpcSocketLine(stdoutBuffer) || consumePipelineProgressLine(stdoutBuffer) || consumePipelineLine(stdoutBuffer)) {
        stdoutBuffer = ''
      } else {
        pushLog(`[pipeline] ${stdoutBuffer}`)
        stdoutBuffer = ''
      }
    }
    if (stderrBuffer.trim()) {
      if (consumeTtpLine(stderrBuffer) || consumePipelineProgressLine(stderrBuffer) || consumePipelineLine(stderrBuffer)) {
        stderrBuffer = ''
      } else {
        pushLog(`[pipeline] ${stderrBuffer}`)
        stderrBuffer = ''
      }
    }
  }

  pipelineChild.stdout?.on('end', flushBuffers)
  pipelineChild.stderr?.on('end', flushBuffers)

  pipelineChild.on('error', (err) => {
    pushLog(`Pipeline spawn error: ${err.message}`)
  })
  pipelineChild.on('close', (code, signal) => {
    flushBuffers()
    pipelineState.exited = true
    pipelineState.code = code
    pipelineState.signal = signal ?? null
    pushLog(`Pipeline exited code=${code} signal=${signal ?? ''}`)
    pipelineChild = null
    pipelineState.pid = null
    pipelineIpcPath = null
    if (runPipeline) {
      markRunningJobsFailedOnPipelineCrash()
      pushLog('Pipeline process exited; restarting pipeline_watch in 3s')
      if (pipelineRestartTimer) clearTimeout(pipelineRestartTimer)
      pipelineRestartTimer = setTimeout(() => {
        pipelineRestartTimer = null
        pipelineState.exited = false
        pipelineState.code = null
        pipelineState.signal = null
        startPipeline()
      }, 3000)
    }
  })
}

const previewChildren = new Set<ChildProcess>()

function enqueuePreview(videoId: string, previewSeconds: number, source = 'webhook'): string {
  const id = crypto.randomUUID()
  const job: QueuedJob = {
    id,
    type: 'preview_mp3',
    videoId,
    priority: 100,
    enqueuedAt: new Date().toISOString(),
    status: 'queued',
    detail: `${previewSeconds}s`,
    source,
    previewSeconds,
  }
  registerQueuedJob(job)
  drainJobQueue()
  return id
}

function drainJobQueue(): void {
  syncResourceSlots()
  while (jobQueue.length > 0) {
    const next = jobQueue.find((j) => j.type === 'preview_mp3' && j.status === 'queued')
    if (!next || next.previewSeconds == null) break
    if (previewGpuRunning + gpuSlots.current - previewGpuRunning >= gpuSlots.max) break
    const idx = jobQueue.indexOf(next)
    if (idx >= 0) jobQueue.splice(idx, 1)
    next.status = 'running'
    registerQueuedJob(next)
    previewGpuRunning += 1
    syncResourceSlots()
    const child = spawn(process.execPath, [resolvedRenderScript, next.videoId, String(next.previewSeconds)], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    previewChildren.add(child)
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('close', (code) => {
      previewChildren.delete(child)
      previewGpuRunning = Math.max(0, previewGpuRunning - 1)
      next.status = code === 0 ? 'done' : 'failed'
      if (code !== 0) next.detail = `${next.previewSeconds}s — ${err.slice(-400) || `exit ${code}`}`
      registerQueuedJob(next)
      syncResourceSlots()
      pushLog(
        code === 0
          ? `Preview MP3 ok: ${next.videoId} (${next.previewSeconds}s)`
          : `Preview MP3 FAILED: ${next.videoId} (${next.previewSeconds}s) ${err.slice(-200)}`,
      )
      drainJobQueue()
    })
    child.on('error', () => {
      previewChildren.delete(child)
      previewGpuRunning = Math.max(0, previewGpuRunning - 1)
      syncResourceSlots()
    })
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown | null> {
  const chunks: Buffer[] = []
  let byteCount = 0
  for await (const c of req) {
    byteCount += c.length
    if (byteCount > MAX_BODY_SIZE) return null
    chunks.push(c)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function sdNotify(state: string): void {
  const sock = process.env.NOTIFY_SOCKET
  if (!sock) return
  void import('node:dgram').then((dgram) => {
    // systemd NOTIFY_SOCKET uses unix_dgram; @types/node omits this socket type
    // @ts-expect-error unix_dgram is valid at runtime for sd_notify
    const client = dgram.createSocket('unix_dgram')
    // @ts-expect-error path argument for unix_dgram send
    client.send(state, 0, state.length, sock, () => client.close())
  }).catch(() => {})
}

function hasStuckRunningJobs(): boolean {
  const thresholdMs = STUCK_JOB_MINUTES * 60 * 1000
  const now = Date.now()
  for (const job of jobsById.values()) {
    if (job.status !== 'running') continue
    const active = pipelineActiveJobs.get(job.videoId)
    if (!active?.updatedAt) continue
    const updated = Date.parse(active.updatedAt)
    if (Number.isFinite(updated) && now - updated > thresholdMs) return true
  }
  return false
}

function verifySignature(rawBody, sigHeader, ts) {
  if (!secret) return false
  if (!sigHeader || typeof sigHeader !== 'string') return false
  if (!ts || typeof ts !== 'string') return false
  const m = sigHeader.match(/^sha256=([0-9a-f]{64})$/i)
  if (!m) return false
  const signedPayload = `${ts}.${rawBody}`
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')
  const a = Buffer.from(m[1], 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj, null, 2))
}

function runCommandCapture(command: string, args: string[], cwd: string): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout}`))
      }
    })
  })
}

async function checkAndApplyPodcastHostUpgrade() {
  if (!autoUpgradeEnabled) return
  let pulled = false
  try {
    await runCommandCapture('git', ['fetch', 'origin', autoUpgradeBranch], autoUpgradeRepoDir)
    const local = await runCommandCapture('git', ['rev-parse', 'HEAD'], autoUpgradeRepoDir)
    const remote = await runCommandCapture('git', ['rev-parse', `origin/${autoUpgradeBranch}`], autoUpgradeRepoDir)
    const localSha = local.stdout.trim()
    const remoteSha = remote.stdout.trim()
    if (!localSha || !remoteSha || localSha === remoteSha) return
    const changed = await runCommandCapture(
      'git',
      ['diff', '--name-only', `${localSha}..${remoteSha}`, '--', autoUpgradePath],
      autoUpgradeRepoDir,
    )
    if (!changed.stdout.trim()) return
    pushLog(`[upgrade] podcast-host delta detected (${localSha.slice(0, 7)} -> ${remoteSha.slice(0, 7)}), pulling latest changes`)
    await runCommandCapture('git', ['pull', 'origin', autoUpgradeBranch], autoUpgradeRepoDir)
    pulled = true
    pushLog('[upgrade] pull successful; rebuilding @vmp/podcast-host')
    await runCommandCapture('npm', ['run', 'build', '--workspace=@vmp/podcast-host'], autoUpgradeRepoDir)
    pushLog('[upgrade] build successful; exiting for container/service restart')
    process.exit(0)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (pulled) {
      pushLog(`[upgrade] build failed after pull; exiting for systemd restart: ${msg}`)
      process.exit(1)
    }
    pushLog(`[upgrade] check failed: ${msg}`)
  }
}

function dashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>VMP media host</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; background: #0f172a; color: #e2e8f0; }
    h1 { font-size: 1.25rem; }
    section { margin: 1rem 0; padding: 1rem; background: #1e293b; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #334155; }
    .ok { color: #4ade80; }
    .fail { color: #f87171; }
    .run { color: #fbbf24; }
    .progress { background: #334155; border-radius: 4px; height: 10px; overflow: hidden; min-width: 120px; }
    .progress > span { display: block; height: 100%; background: linear-gradient(90deg, #22c55e, #4ade80); transition: width 0.4s ease; }
    .progress-meta { font-size: 0.75rem; color: #94a3b8; margin-top: 0.15rem; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 0.75rem; max-height: 16rem; overflow: auto; background: #0f172a; padding: 0.75rem; border-radius: 6px; }
    .btn { font-size: 0.75rem; padding: 0.2rem 0.45rem; margin-right: 0.25rem; cursor: pointer; border-radius: 4px; border: 1px solid #475569; background: #334155; color: #e2e8f0; }
    .btn:hover { background: #475569; }
    .btn-danger { border-color: #b91c1c; background: #7f1d1d; }
    .badge { display: inline-block; font-size: 0.7rem; padding: 0.1rem 0.35rem; border-radius: 4px; background: #334155; color: #cbd5e1; cursor: pointer; }
    .phase-label { font-size: 0.75rem; color: #94a3b8; margin-bottom: 0.15rem; }
  </style>
</head>
<body>
  <h1>VMP media host</h1>
  <p>Local observability for <code>video_pipeline_watch</code> and preview MP3 jobs. Refreshes every 3s.</p>
  <section>
    <h2>Pipeline</h2>
    <div id="pipeline">Loading…</div>
  </section>
  <section>
    <h2>Jobs (pipeline)</h2>
    <div id="pipeline-jobs">Loading…</div>
  </section>
  <section>
    <h2>Jobs (preview MP3)</h2>
    <div id="jobs">Loading…</div>
  </section>
  <section>
    <h2>Successful jobs log (pipeline)</h2>
    <div id="pipeline-success">Loading…</div>
  </section>
  <section>
    <h2>TTP summaries (time to publish)</h2>
    <div id="ttp">Loading…</div>
  </section>
  <section>
    <h2>Recent log</h2>
    <pre id="log">Loading…</pre>
  </section>
  <script>
    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }
    function formatEta(sec) {
      if (sec == null || !Number.isFinite(sec) || sec <= 0) return ''
      const m = Math.floor(sec / 60)
      const s = Math.floor(sec - m * 60)
      return m > 0 ? m + 'm ' + s + 's' : s + 's'
    }
    function dualPhaseProgress(j) {
      const p1 = typeof j.progressPhase1Pct === 'number' ? Math.round(j.progressPhase1Pct * 100) : null
      const p2 = typeof j.progressPhase2Pct === 'number' ? Math.round(j.progressPhase2Pct * 100) : null
      const showP2 = j.progressPhase2Started || (p2 != null && p2 > 0)
      let html = '<div class="phase-label">Phase 1 (720p)</div>'
      html += p1 != null
        ? '<div class="progress" title="Phase 1 ' + p1 + '%"><span style="width:' + p1 + '%"></span></div>'
        : '<div class="progress"><span style="width:0%"></span></div>'
      if (showP2) {
        html += '<div class="phase-label" style="margin-top:0.35rem">Phase 2 (full)</div>'
        html += p2 != null
          ? '<div class="progress" title="Phase 2 ' + p2 + '%"><span style="width:' + p2 + '%"></span></div>'
          : '<div class="progress"><span style="width:0%"></span></div>'
      }
      const meta = []
      if (j.progressRendition) meta.push(j.progressRendition)
      if (typeof j.progressOverall === 'number') meta.push('overall ' + Math.round(j.progressOverall * 100) + '%')
      if (meta.length) html += '<div class="progress-meta">' + escapeHtml(meta.join(' · ')) + '</div>'
      return html
    }
    function jobControls(j) {
      const vid = escapeHtml(j.videoId || '')
      const paused = j.status === 'paused'
      const btns = []
      if (!paused) btns.push('<button class="btn" data-action="pause" data-video="' + vid + '">Pause</button>')
      else btns.push('<button class="btn" data-action="resume" data-video="' + vid + '">Resume</button>')
      btns.push('<button class="btn btn-danger" data-action="stop" data-video="' + vid + '">Stop</button>')
      return btns.join('')
    }
    function priorityBadge(j) {
      const p = j.priority != null ? j.priority : 100
      return '<span class="badge" data-action="priority" data-video="' + escapeHtml(j.videoId || '') + '" title="Click to edit priority">' + p + '</span>'
    }
    async function postJob(path, body) {
      await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    }
    document.addEventListener('click', async (ev) => {
      const el = ev.target
      if (!(el instanceof HTMLElement)) return
      const action = el.getAttribute('data-action')
      const videoId = el.getAttribute('data-video')
      if (!action || !videoId) return
      if (action === 'pause') { await postJob('/api/jobs/' + encodeURIComponent(videoId) + '/pause'); return }
      if (action === 'resume') { await postJob('/api/jobs/' + encodeURIComponent(videoId) + '/resume'); return }
      if (action === 'priority') {
        const next = window.prompt('Priority (lower = sooner)', el.textContent || '100')
        if (next == null) return
        const priority = Number.parseInt(next, 10)
        if (!Number.isFinite(priority)) return
        await postJob('/api/jobs/' + encodeURIComponent(videoId) + '/priority', { priority })
        return
      }
      if (action === 'stop') {
        if (el.getAttribute('data-confirm') !== '1') {
          el.outerHTML = '<span>Confirm stop?</span> <button class="btn btn-danger" data-action="stop" data-confirm="1" data-video="' + escapeHtml(videoId) + '">Yes</button> <button class="btn" data-action="cancel-stop" data-video="' + escapeHtml(videoId) + '">Cancel</button>'
          return
        }
        await postJob('/api/jobs/' + encodeURIComponent(videoId) + '/stop')
        return
      }
      if (action === 'cancel-stop') { tick(); return }
    })
    async function tick() {
      try {
        const r = await fetch('/api/status')
        const d = await r.json()
        const p = d.pipeline || {}
        document.getElementById('pipeline').innerHTML =
          '<p><strong>Script:</strong> ' + escapeHtml(p.script || '') + '</p>' +
          '<p><strong>PID:</strong> ' + escapeHtml(p.pid ?? '—') +
          ' · <strong>Started:</strong> ' + escapeHtml(p.startedAt || '—') + '</p>' +
          '<p><strong>Status:</strong> ' +
          (p.exited ? ('exited code ' + escapeHtml(p.code) + (p.signal ? ' signal ' + escapeHtml(p.signal) : '')) : 'running') +
          '</p>'
        const pipelineRows = (d.pipelineActiveJobs || []).map(j =>
          '<tr><td>' + dualPhaseProgress(j) + '</td><td>' + escapeHtml(j.status || '') + '</td><td>' + escapeHtml(j.videoId || '') +
          '</td><td>' + escapeHtml(j.stageLabel || j.stage || '') + '</td><td>' + jobControls(j) + '</td><td>' + priorityBadge(j) +
          '</td><td>' + (j.queuePosition != null ? escapeHtml(String(j.queuePosition)) : '—') + '</td><td>' + escapeHtml(j.detail || '') +
          '</td><td>' + escapeHtml(j.source || '') + '</td><td>' + escapeHtml(j.updatedAt || '') + '</td></tr>'
        ).join('')
        document.getElementById('pipeline-jobs').innerHTML = '<table><thead><tr><th>Progress</th><th>Status</th><th>Video</th><th>Stage</th><th>Controls</th><th>Priority</th><th>Queue #</th><th>Detail</th><th>Source</th><th>Updated</th></tr></thead><tbody>' + pipelineRows + '</tbody></table>'
        const queued = (d.jobQueue || []).filter(j => j.status === 'queued')
        const rows = queued.map(j =>
          '<tr><td>' + escapeHtml(j.status || '') + '</td><td>' + escapeHtml(j.type || '') + '</td><td>' + escapeHtml(j.videoId || '') +
          '</td><td>' + escapeHtml(j.detail || '') + '</td><td>' + priorityBadge(j) + '</td><td>' + (j.queuePosition != null ? escapeHtml(String(j.queuePosition)) : '—') +
          '</td><td>' + escapeHtml(j.source || '') + '</td></tr>'
        ).join('')
        document.getElementById('jobs').innerHTML = '<table><thead><tr><th>Status</th><th>Type</th><th>Video</th><th>Detail</th><th>Priority</th><th>Queue #</th><th>Source</th></tr></thead><tbody>' + rows + '</tbody></table>'
        const successRows = (d.pipelineSuccessfulJobs || []).map(j =>
          '<tr><td>' + escapeHtml(j.videoId || '') + '</td><td>' + escapeHtml(j.stageLabel || j.stage || '') + '</td><td>' + escapeHtml(j.detail || '') + '</td><td>' + escapeHtml(j.finishedAt || '') + '</td></tr>'
        ).join('')
        document.getElementById('pipeline-success').innerHTML = '<table><thead><tr><th>Video</th><th>Final stage</th><th>Detail</th><th>Finished</th></tr></thead><tbody>' + successRows + '</tbody></table>'
        const ttpRows = (d.ttpSummaries || []).map(s =>
          '<tr><td>' + escapeHtml(s.videoId || '') + '</td><td>' + escapeHtml(s.minimalMs != null ? (s.minimalMs / 1000).toFixed(1) + 's' : '—') + '</td><td>' + escapeHtml(s.fullMs != null ? (s.fullMs / 1000).toFixed(1) + 's' : '—') + '</td><td>' + escapeHtml(s.minimalRatio != null ? Number(s.minimalRatio).toFixed(2) + '×' : '—') + '</td><td>' + escapeHtml(s.fullRatio != null ? Number(s.fullRatio).toFixed(2) + '×' : '—') + '</td><td>' + escapeHtml(s.at || '') + '</td></tr>'
        ).join('')
        document.getElementById('ttp').innerHTML = '<table><thead><tr><th>Video</th><th>Minimal (720p)</th><th>Full renditions</th><th>Ratio minimal</th><th>Ratio full</th><th>At</th></tr></thead><tbody>' + ttpRows + '</tbody></table>'
        document.getElementById('log').textContent = (d.logLines || []).join('\\n')
      } catch (e) {
        document.getElementById('pipeline').textContent = 'Error: ' + e
      }
    }
    tick()
    setInterval(tick, 3000)
  </script>
</body>
</html>`
}

const REBUILD_WEBHOOK_PATHS = new Set([
  '/api/podcast-preview-rebuild',
  '/vmp/api/podcast-preview-rebuild',
  '/vmp/podcast-preview-rebuild',
])

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${uiHost}:${uiPort}`)

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(dashboardHtml())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const activeRows = Array.from(pipelineActiveJobs.values())
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((job) => ({
        ...job,
        stageLabel: stageLabel(job.stage),
        queuePosition: getQueuePosition(job.videoId),
      }))
    const successRows = pipelineSuccessfulJobs.map((job) => ({
      ...job,
      stageLabel: stageLabel(job.stage),
    }))
    const failedRows = failedPipelineJobs.map((job) => ({
      ...job,
      stageLabel: stageLabel(job.stage),
    }))
    const queuedJobs = jobQueue
      .filter((j) => j.status === 'queued')
      .map((j, _i, arr) => {
        sortJobQueue()
        return { ...j, queuePosition: getQueuePosition(j.videoId) }
      })
    json(res, {
      pipeline: {
        script: resolvedPipelineScript,
        renderScript: resolvedRenderScript,
        runPipeline,
        pid: pipelineState.pid,
        startedAt: pipelineState.startedAt,
        exited: pipelineState.exited,
        code: pipelineState.code,
        signal: pipelineState.signal,
        ipcPath: pipelineIpcPath,
      },
      gpuSlots,
      uploadSlots,
      previewGpuRunning,
      jobQueue: jobQueue.map((j) => ({ ...j, queuePosition: getQueuePosition(j.videoId) })),
      jobs: Array.from(jobsById.values()),
      pipelineActiveJobs: activeRows,
      pipelineSuccessfulJobs: successRows,
      failedPipelineJobs: failedRows,
      ttpSummaries,
      logLines,
    })
    return
  }

  if (REBUILD_WEBHOOK_PATHS.has(url.pathname) && req.method !== 'POST') {
    json(res, {
      error: 'Method not allowed',
      expectedMethod: 'POST',
      endpoint: '/api/podcast-preview-rebuild',
    }, 405)
    return
  }

  if (req.method === 'POST' && REBUILD_WEBHOOK_PATHS.has(url.pathname)) {
    const chunks = []
    let byteCount = 0
    for await (const c of req) {
      byteCount += c.length
      if (byteCount > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
        req.destroy()
        return
      }
      chunks.push(c)
    }
    const rawBody = Buffer.concat(chunks)

    if (secret) {
      // Validate timestamp freshness
      const tsHeader = req.headers['x-vmp-timestamp']
      const ts = Array.isArray(tsHeader) ? tsHeader[0] : tsHeader
      if (!ts) {
        json(res, { error: 'Invalid or stale timestamp' }, 401)
        return
      }
      const tsNum = Number(ts)
      if (!Number.isFinite(tsNum) || tsNum <= 0) {
        json(res, { error: 'Invalid or stale timestamp' }, 401)
        return
      }
      const nowSec = Math.floor(Date.now() / 1000)
      const skewWindow = 5 * 60 // 5 minutes in seconds
      if (Math.abs(nowSec - tsNum) > skewWindow) {
        json(res, { error: 'Invalid or stale timestamp' }, 401)
        return
      }

      // Verify signature
      const sig = req.headers['x-vmp-signature']
      if (!verifySignature(rawBody, Array.isArray(sig) ? sig[0] : sig, ts)) {
        json(res, { error: 'Invalid signature' }, 401)
        return
      }
    }

    let payload
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      json(res, { error: 'Invalid JSON' }, 400)
      return
    }

    if (payload?.event !== 'podcast_preview_rebuild') {
      json(res, { error: 'Unexpected event', code: 'invalid_event', expectedEvent: 'podcast_preview_rebuild' }, 400)
      return
    }

    const videos = Array.isArray(payload.videos) ? payload.videos : []
    const accepted = []
    const rejected = []
    for (const v of videos) {
      const id = v?.id
      const sec = Number(v?.previewDurationSeconds)
      if (!id || !Number.isFinite(sec) || sec <= 0) {
        rejected.push({ id: String(id || ''), reason: 'invalid_preview_duration' })
        continue
      }
      // Reject path-like IDs to prevent directory traversal
      if (typeof id !== 'string' || id.includes('/') || id.includes('\\') || id.includes('..')) {
        pushLog(`Rejected invalid video ID: ${id}`)
        rejected.push({ id: String(id || ''), reason: 'invalid_video_id' })
        continue
      }
      // Stricter validation: allow only alphanumerics, dash, dot, underscore
      if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
        pushLog(`Rejected invalid video ID: ${id}`)
        rejected.push({ id: String(id || ''), reason: 'invalid_video_id' })
        continue
      }
      accepted.push({ jobId: enqueuePreview(id, Math.floor(sec), 'webhook'), videoId: id, previewSeconds: Math.floor(sec) })
    }

    json(res, {
      ok: true,
      code: 'accepted',
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      jobs: accepted,
      rejected,
    }, accepted.length > 0 ? 202 : 200)
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, { ok: true })
    return
  }

  const jobControlMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(pause|resume|stop|priority)$/)
  if (req.method === 'POST' && jobControlMatch) {
    const videoId = decodeURIComponent(jobControlMatch[1])
    const action = jobControlMatch[2]
    if (action === 'priority') {
      const body = await readJsonBody(req)
      if (body === null) {
        json(res, { error: 'Invalid JSON' }, 400)
        return
      }
      const priority = Number((body as { priority?: number }).priority)
      if (!Number.isFinite(priority)) {
        json(res, { error: 'Invalid priority' }, 400)
        return
      }
      const job = jobsByVideoId.get(videoId)
      if (job) {
        job.priority = priority
        registerQueuedJob(job)
      }
      const active = pipelineActiveJobs.get(videoId)
      if (active) active.priority = priority
      sortJobQueue()
      json(res, { ok: true, newPosition: getQueuePosition(videoId) })
      return
    }
    const ipcResult = await sendPipelineCommand(action as 'pause' | 'resume' | 'stop', videoId)
    const job = jobsByVideoId.get(videoId)
    if (job) {
      if (action === 'pause') job.status = 'paused'
      else if (action === 'resume') job.status = 'running'
      else if (action === 'stop') job.status = 'stopped'
      registerQueuedJob(job)
    }
    const active = pipelineActiveJobs.get(videoId)
    if (active) {
      if (action === 'pause') active.status = 'paused'
      else if (action === 'resume') active.status = 'active'
      else if (action === 'stop') {
        active.status = 'failed'
        active.detail = 'stopped_by_user'
      }
    }
    if (!ipcResult.ok) {
      json(res, ipcResult, 502)
      return
    }
    json(res, { ok: true })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/jobs/reorder') {
    const body = await readJsonBody(req)
    if (body === null) {
      json(res, { error: 'Invalid JSON' }, 400)
      return
    }
    const order = (body as { order?: string[] }).order
    if (!Array.isArray(order)) {
      json(res, { error: 'Missing order array' }, 400)
      return
    }
    order.forEach((videoId, index) => {
      const job = jobsByVideoId.get(String(videoId))
      if (job) {
        job.priority = index
        registerQueuedJob(job)
      }
      const active = pipelineActiveJobs.get(String(videoId))
      if (active) active.priority = index
    })
    sortJobQueue()
    const ipcResult = await sendPipelineCommand('reorder', undefined, { order: order.map(String) })
    if (!ipcResult.ok) {
      json(res, ipcResult, 502)
      return
    }
    json(res, { ok: true })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(uiPort, uiHost, () => {
  pushLog(
    `Dashboard http://${uiHost}:${uiPort}/  (webhook POST /api/podcast-preview-rebuild or /vmp/api/podcast-preview-rebuild)`,
  )
  pushLog(`Config: runPipeline=${runPipeline} gpuConcurrency=${MAX_GPU_JOBS} uploadConcurrency=${MAX_UPLOAD_JOBS} pipelineScript=${resolvedPipelineScript} renderScript=${resolvedRenderScript}`)
  sdNotify('READY=1')
  startPipeline()
  setInterval(() => {
    if (pipelineChild && !pipelineState.exited && !hasStuckRunningJobs()) {
      sdNotify('WATCHDOG=1')
    }
  }, 20_000)
  if (autoUpgradeEnabled) {
    pushLog(`[upgrade] enabled, watching ${autoUpgradePath} on ${autoUpgradeBranch} every ${Math.round(autoUpgradeCheckMs / 1000)}s`)
    void checkAndApplyPodcastHostUpgrade()
    setInterval(() => { void checkAndApplyPodcastHostUpgrade() }, autoUpgradeCheckMs)
  }
})

const gracefulShutdown = async (signal) => {
  pushLog(`${signal} — stopping`)
  sdNotify('STOPPING=1')
  if (pipelineRestartTimer) clearTimeout(pipelineRestartTimer)
  if (pipelineChild && !pipelineState.exited) {
    try {
      pipelineChild.kill('SIGTERM')
    } catch {}
  }
  for (const child of previewChildren) {
    try {
      child.kill('SIGTERM')
    } catch {}
  }
  // Give children a moment to exit gracefully
  await new Promise((resolve) => setTimeout(resolve, 1000))
  for (const child of previewChildren) {
    try {
      child.kill('SIGKILL')
    } catch {}
  }
  server.close(() => process.exit(0))
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM') })
process.on('SIGINT', () => { void gracefulShutdown('SIGINT') })
