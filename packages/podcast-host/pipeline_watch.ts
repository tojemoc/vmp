#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readdir, rm, rename, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

type PipelineStatus = 'active' | 'success' | 'failed'
type PipelineStage =
  | 'detected' | 'deduped' | 'wait_upload_complete' | 'probe'
  | 'phase1_encode' | 'phase1_upload' | 'phase1_available'
  | 'phase2_encode' | 'phase2_package' | 'phase2_upload' | 'phase2_manifest_swap' | 'multi_rendition_ready'
  | 'podcast_mp3' | 'preview_wait' | 'preview_render' | 'preview_upload' | 'cleanup' | 'done' | 'failed'
type QueueJob = { videoId: string, inputPath: string, source: string }
type RunResult = { stdout: string, stderr: string }
type RunOptions = { capture?: boolean }
type ResolveInputTargetPathResult = { videoId: string, targetPath: string, renamed: boolean, reason?: 'legacy_filename' | 'random_uuid' | 'already_uuid' }
type RenditionKey = '1080p' | '720p' | '480p'
type Phase1Result = { audioTmpPath: string | null, hasAudio: boolean }

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

const RENDITION_CONFIG: Record<RenditionKey, { out: string, w: string, h: string, br: string, max: string, buf: string, abr: string }> = {
  '1080p': { out: '1080p.mp4', w: '1920', h: '1080', br: '5M', max: '5M', buf: '10M', abr: '128k' },
  '720p': { out: '720p.mp4', w: '1280', h: '720', br: '3M', max: '3M', buf: '6M', abr: '128k' },
  '480p': { out: '480p.mp4', w: '854', h: '480', br: '1500k', max: '1500k', buf: '3000k', abr: '96k' },
}

function log(msg: string): void {
  process.stdout.write(`${new Date().toISOString()} ${msg}\n`)
}

let shuttingDown = false
const activeChildren = new Set<import('node:child_process').ChildProcess>()

function trackChild<T extends import('node:child_process').ChildProcess>(child: T): T {
  activeChildren.add(child)
  const clear = () => activeChildren.delete(child)
  child.once('close', clear)
  child.once('error', clear)
  return child
}

function emitPipelineEvent(videoId: string, stage: PipelineStage, status: PipelineStatus, detail = ''): void {
  process.stdout.write(`VMP_PIPELINE_EVENT\t${videoId}\t${stage}\t${status}\t${detail}\n`)
}

function run(command: string, args: string[], label: string, { capture = false }: RunOptions = {}): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = trackChild(spawn(command, args, { env: process.env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] }))
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

async function detectHasAudio(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath], 'ffprobe audio', { capture: true })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function writePhase1MasterM3u8(tmpDir: string): Promise<void> {
  const content = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
    '720p/playlist.m3u8',
    '',
  ].join('\n')
  await writeFile(path.join(tmpDir, 'master.m3u8'), content)
}

async function writePhase2MasterM3u8(tmpDir: string): Promise<void> {
  const content = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
    '1080p/playlist.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720',
    '720p/playlist.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=854x480',
    '480p/playlist.m3u8',
    '',
  ].join('\n')
  await writeFile(path.join(tmpDir, 'master.m3u8'), content)
}

async function encodeRendition(
  videoId: string,
  inputPath: string,
  tmpDir: string,
  key: RenditionKey,
  options: { includeAudio: boolean, stage: PipelineStage },
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
  await run('ffmpeg', args, `encode ${r.out}`)
  const finalPath = path.join(tmpDir, r.out)
  await rename(outPath, finalPath)
  return finalPath
}

async function packagePhase1Hls(tmpDir: string, hasAudio: boolean): Promise<void> {
  await mkdir(path.join(tmpDir, '720p'), { recursive: true })
  const shakaArgs = [
    `input=${path.join(tmpDir, '720p.mp4')},stream=video,init_segment=${path.join(tmpDir, '720p/init_720.mp4')},segment_template=${path.join(tmpDir, '720p/seg_720_$Number$.m4s')},playlist_name=720p/playlist.m3u8`,
  ]
  if (hasAudio) {
    shakaArgs.push(
      `input=${path.join(tmpDir, '720p.mp4')},stream=audio,init_segment=${path.join(tmpDir, 'init_audio.mp4')},segment_template=${path.join(tmpDir, 'seg_audio_$Number$.m4s')}`,
    )
  }
  shakaArgs.push(
    '--segment_duration', '6',
    '--fragment_duration', '6',
    '--hls_master_playlist_output', path.join(tmpDir, 'master.m3u8.shaka'),
  )
  await run('shaka-packager', shakaArgs, 'shaka-packager phase1')
  await writePhase1MasterM3u8(tmpDir)
}

async function packagePhase2Hls(tmpDir: string, hasAudio: boolean): Promise<void> {
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
      `input=${path.join(tmpDir, '720p.mp4')},stream=audio,init_segment=${path.join(tmpDir, 'init_audio.mp4')},segment_template=${path.join(tmpDir, 'seg_audio_$Number$.m4s')}`,
    )
  }
  shakaArgs.push(
    '--segment_duration', '6',
    '--fragment_duration', '6',
    '--hls_master_playlist_output', path.join(tmpDir, 'master.m3u8.shaka'),
  )
  await run('shaka-packager', shakaArgs, 'shaka-packager phase2')
  await writePhase2MasterM3u8(tmpDir)
}

async function rcloneCopyDir(localDir: string, r2Dest: string, label: string): Promise<void> {
  await run('rclone', ['copy', localDir, r2Dest, '--transfers', '8', '--checkers', '16'], label)
}

async function rcloneCopyFile(localFile: string, r2Dest: string, label: string): Promise<void> {
  await run('rclone', ['copyto', localFile, r2Dest, '--checkers', '16'], label)
}

async function rcloneCheckDir(localDir: string, r2Dest: string, label: string): Promise<void> {
  await run('rclone', ['check', localDir, r2Dest, '--one-way'], label)
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
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VMP-Signature': `sha256=${signature}`,
          'X-VMP-Timestamp': ts,
        },
        body: rawBody,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!retry) {
        log(`⚠️ ${videoId}: pipeline status callback failed (${stage}), retrying in 5s: ${msg}`)
        await new Promise((r) => setTimeout(r, 5000))
        return attempt(true)
      }
      log(`⚠️ ${videoId}: pipeline status callback gave up (${stage}): ${msg}`)
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
  emitPipelineEvent(videoId, 'phase1_encode', 'active', '720p')
  const audioTmpPath = await encodeRendition(videoId, inputPath, tmpDir, '720p', { includeAudio: hasAudio, stage: 'phase1_encode' })
  emitPipelineEvent(videoId, 'phase1_encode', 'active', 'done')

  emitPipelineEvent(videoId, 'phase1_encode', 'active', 'packaging_hls')
  await packagePhase1Hls(tmpDir, hasAudio)

  emitPipelineEvent(videoId, 'phase1_upload', 'active', 'start')
  const r2Base = r2Path(`videos/${videoId}`)
  await rcloneCopyDir(path.join(tmpDir, '720p'), `${r2Base}/720p`, 'rclone upload 720p phase1')
  if (hasAudio && existsSync(path.join(tmpDir, 'init_audio.mp4'))) {
    await rcloneCopyFile(path.join(tmpDir, 'init_audio.mp4'), `${r2Base}/init_audio.mp4`, 'rclone upload init_audio phase1')
    const audioSegs = (await readdir(tmpDir)).filter((f) => /^seg_audio_\d+\.m4s$/.test(f))
    for (const seg of audioSegs) {
      await rcloneCopyFile(path.join(tmpDir, seg), `${r2Base}/${seg}`, `rclone upload ${seg} phase1`)
    }
  }
  await rcloneCheckDir(path.join(tmpDir, '720p'), `${r2Base}/720p`, 'rclone check 720p phase1')
  await rcloneCopyFile(path.join(tmpDir, 'master.m3u8'), `${r2Base}/master.m3u8`, 'rclone upload master phase1')
  emitPipelineEvent(videoId, 'phase1_upload', 'active', 'done')

  await notifyVideoAvailable(videoId, 'preview_ready', ['720p'])
  emitPipelineEvent(videoId, 'phase1_available', 'success', 'preview_ready')

  return { audioTmpPath: hasAudio ? audioTmpPath : null, hasAudio }
}

async function phase2RemainingRenditions(
  videoId: string,
  inputPath: string,
  tmpDir: string,
  hasAudio: boolean,
): Promise<void> {
  emitPipelineEvent(videoId, 'phase2_encode', 'active', '1080p+480p')
  await encodeRendition(videoId, inputPath, tmpDir, '1080p', { includeAudio: false, stage: 'phase2_encode' })
  await encodeRendition(videoId, inputPath, tmpDir, '480p', { includeAudio: false, stage: 'phase2_encode' })
  emitPipelineEvent(videoId, 'phase2_encode', 'active', 'done')

  emitPipelineEvent(videoId, 'phase2_package', 'active', 'start')
  await packagePhase2Hls(tmpDir, hasAudio)
  emitPipelineEvent(videoId, 'phase2_package', 'active', 'done')

  emitPipelineEvent(videoId, 'phase2_upload', 'active', 'start')
  const r2Base = r2Path(`videos/${videoId}`)
  await rcloneCopyDir(path.join(tmpDir, '1080p'), `${r2Base}/1080p`, 'rclone upload 1080p phase2')
  await rcloneCopyDir(path.join(tmpDir, '480p'), `${r2Base}/480p`, 'rclone upload 480p phase2')
  await rcloneCopyDir(path.join(tmpDir, '720p'), `${r2Base}/720p`, 'rclone upload 720p phase2')
  await rcloneCheckDir(path.join(tmpDir, '1080p'), `${r2Base}/1080p`, 'rclone check 1080p phase2')
  await rcloneCheckDir(path.join(tmpDir, '480p'), `${r2Base}/480p`, 'rclone check 480p phase2')
  await rcloneCheckDir(path.join(tmpDir, '720p'), `${r2Base}/720p`, 'rclone check 720p phase2')
  if (hasAudio && existsSync(path.join(tmpDir, 'init_audio.mp4'))) {
    await rcloneCopyFile(path.join(tmpDir, 'init_audio.mp4'), `${r2Base}/init_audio.mp4`, 'rclone upload init_audio phase2')
    const audioSegs = (await readdir(tmpDir)).filter((f) => /^seg_audio_\d+\.m4s$/.test(f))
    for (const seg of audioSegs) {
      await rcloneCopyFile(path.join(tmpDir, seg), `${r2Base}/${seg}`, `rclone upload ${seg} phase2`)
    }
  }

  emitPipelineEvent(videoId, 'phase2_manifest_swap', 'active', 'upload_master')
  await rcloneCopyFile(path.join(tmpDir, 'master.m3u8'), `${r2Base}/master.m3u8`, 'rclone upload master phase2')
  emitPipelineEvent(videoId, 'phase2_upload', 'active', 'done')

  await notifyVideoAvailable(videoId, 'fully_processed', ['1080p', '720p', '480p'])
  emitPipelineEvent(videoId, 'multi_rendition_ready', 'success', 'fully_processed')
}

async function encodePodcastMp3(videoId: string, inputPath: string, tmpDir: string): Promise<void> {
  emitPipelineEvent(videoId, 'podcast_mp3', 'active', 'start')
  const mp3Tmp = path.join(tmpDir, `podcast.mp3.tmp.${process.pid}`)
  await run('ffmpeg', ['-hide_banner', '-y', '-i', inputPath, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-f', 'mp3', mp3Tmp], 'encode podcast mp3')
  await rename(mp3Tmp, path.join(tmpDir, 'podcast.mp3'))
  await run('rclone', ['copyto', path.join(tmpDir, 'podcast.mp3'), r2Path(`videos/${videoId}/podcast.mp3`)], 'upload podcast mp3')
  emitPipelineEvent(videoId, 'podcast_mp3', 'active', 'done')
}

async function processVideo(videoId: string, inputPath: string, source = 'watchfolder'): Promise<void> {
  const tmpDir = path.join(TMP_DIR_BASE, videoId)
  const doneFlag = path.join(tmpDir, '.done')
  const lockFile = path.join(tmpDir, '.lock')
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
  emitPipelineEvent(videoId, 'detected', 'active', `source=${source}`)
  try {
    emitPipelineEvent(videoId, 'wait_upload_complete', 'active', 'waiting_for_file_stability')
    await waitStableSize(inputPath)
    emitPipelineEvent(videoId, 'wait_upload_complete', 'active', 'stable')

    emitPipelineEvent(videoId, 'probe', 'active', 'probing_streams')
    const hasAudio = await detectHasAudio(inputPath)
    emitPipelineEvent(videoId, 'probe', 'active', `hasAudio=${hasAudio}`)

    await phase1EncodeAndPublish(videoId, inputPath, tmpDir, hasAudio)
    emitPipelineEvent(videoId, 'phase1_available', 'active', 'preview_ready')

    const podcastTask = hasAudio
      ? encodePodcastMp3(videoId, inputPath, tmpDir).catch((err) => {
        log(`⚠️ ${videoId}: podcast MP3 failed (video still watchable at 720p): ${err instanceof Error ? err.message : String(err)}`)
        emitPipelineEvent(videoId, 'podcast_mp3', 'failed', err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220))
      })
      : (emitPipelineEvent(videoId, 'podcast_mp3', 'active', 'skipped_no_audio'), Promise.resolve())

    const phase2Task = phase2RemainingRenditions(videoId, inputPath, tmpDir, hasAudio).catch((err) => {
      log(`⚠️ ${videoId}: phase2 failed (720p HLS remains available): ${err instanceof Error ? err.message : String(err)}`)
      emitPipelineEvent(videoId, 'phase2_upload', 'failed', err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220))
    })

    await Promise.all([podcastTask, phase2Task])

    if (PREVIEW_MP3_ENABLED && hasAudio && existsSync(path.join(tmpDir, 'podcast.mp3'))) {
      if (PREVIEW_MP3_LOCK_SECONDS > 0) {
        emitPipelineEvent(videoId, 'preview_wait', 'active', `${PREVIEW_MP3_LOCK_SECONDS}s`)
        await new Promise((r) => setTimeout(r, PREVIEW_MP3_LOCK_SECONDS * 1000))
      }
      emitPipelineEvent(videoId, 'preview_render', 'active', `${PREVIEW_MP3_SECONDS}s`)
      const prevTmp = path.join(tmpDir, `podcast_preview.mp3.tmp.${process.pid}`)
      await run('ffmpeg', ['-hide_banner', '-y', '-i', path.join(tmpDir, 'podcast.mp3'), '-t', String(PREVIEW_MP3_SECONDS), '-vn', '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-f', 'mp3', prevTmp], 'encode preview mp3')
      await rename(prevTmp, path.join(tmpDir, 'podcast_preview.mp3'))
      const probe = await run(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(tmpDir, 'podcast_preview.mp3')],
        'probe preview mp3 duration',
        { capture: true },
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
      emitPipelineEvent(videoId, 'preview_upload', 'active', 'start')
      await run('rclone', ['copyto', path.join(tmpDir, 'podcast_preview.mp3'), r2Path(`videos/${videoId}/podcast_preview.mp3`)], 'upload preview mp3')
      if (existsSync(path.join(tmpDir, 'podcast_preview.meta.json'))) {
        await run('rclone', ['copyto', path.join(tmpDir, 'podcast_preview.meta.json'), r2Path(`videos/${videoId}/podcast_preview.meta.json`)], 'upload preview mp3 metadata')
      }
      emitPipelineEvent(videoId, 'preview_upload', 'active', 'done')
    } else {
      emitPipelineEvent(videoId, 'preview_render', 'active', 'skipped')
    }

    emitPipelineEvent(videoId, 'cleanup', 'active', 'start')
    await writeFile(doneFlag, 'done')
    await rm(inputPath, { force: true })
    await rm(tmpDir, { recursive: true, force: true })
    emitPipelineEvent(videoId, 'done', 'success', 'watchfolder_and_tmp_cleared')
  } catch (err) {
    emitPipelineEvent(videoId, 'failed', 'failed', err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220))
    log(`❌ ${videoId} failed: ${err instanceof Error ? err.message : String(err)}`)
    await rm(lockFile, { force: true })
    throw err
  }
}

const queue: QueueJob[] = []
let running = 0

function enqueue(videoId: string, inputPath: string, source: string): void {
  queue.push({ videoId, inputPath, source })
  drain()
}

async function resolveInputTargetPath(stem: string, ext: string, oldPath: string, source: string): Promise<ResolveInputTargetPathResult> {
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
        await rename(oldPath, candidatePath)
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
      await rename(oldPath, candidatePath)
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
    running += 1
    processVideo(job.videoId, job.inputPath, job.source)
      .catch(() => {})
      .finally(() => {
        running -= 1
        drain()
      })
  }
}

async function startupScan(): Promise<void> {
  await mkdir(INBOX_DIR, { recursive: true })
  await mkdir(TMP_DIR_BASE, { recursive: true })
  const entries = await readdir(INBOX_DIR)
  for (const file of entries) {
    if (!/\.(mp4|mkv|mov)$/i.test(file)) continue
    const stem = file.replace(/\.[^.]+$/, '')
    const oldPath = path.join(INBOX_DIR, file)
    const ext = file.split('.').pop() || 'mp4'
    const { videoId, targetPath, renamed, reason } = await resolveInputTargetPath(stem, ext, oldPath, 'startup_scan')
    if (renamed) {
      const detail = reason === 'random_uuid' ? 'Generated random VIDEO_ID' : 'Sanitized VIDEO_ID'
      log(`🧼 ${detail} startup_scan: '${stem}' -> '${videoId}'`)
    }
    enqueue(videoId, targetPath, 'startup_scan')
  }
}

function startWatcher() {
  const child = trackChild(spawn('inotifywait', ['-m', '-e', 'close_write', '--format', '%f', INBOX_DIR], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] }))
  let stdoutBuffer = ''
  const processLines = async (lines: string[]): Promise<void> => {
    for (const file of lines) {
      if (!/\.(mp4|mkv|mov)$/i.test(file)) continue
      const stem = file.replace(/\.[^.]+$/, '')
      const oldPath = path.join(INBOX_DIR, file)
      const ext = file.split('.').pop() || 'mp4'
      const { videoId, targetPath, renamed, reason } = await resolveInputTargetPath(stem, ext, oldPath, 'watchfolder')
      if (renamed) {
        const detail = reason === 'random_uuid' ? 'Generated random VIDEO_ID' : 'Sanitized VIDEO_ID'
        log(`🧼 ${detail} watchfolder: '${stem}' -> '${videoId}'`)
      }
      enqueue(videoId, targetPath, 'watchfolder')
    }
  }
  child.stdout.on('data', async (chunk) => {
    stdoutBuffer += chunk.toString()
    const parts = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = parts.pop() ?? ''
    const lines = parts.filter(Boolean)
    await processLines(lines)
  })
  child.on('close', (code) => {
    if (stdoutBuffer.trim()) {
      const trailing = stdoutBuffer.trim()
      stdoutBuffer = ''
      processLines([trailing]).catch((err) => {
        log(`watcher trailing line processing failed: ${err instanceof Error ? err.message : String(err)}`)
      })
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
        if (!/\.(mp4|mkv|mov)$/i.test(file)) continue
        const stem = file.replace(/\.[^.]+$/, '')
        const oldPath = path.join(INBOX_DIR, file)
        const ext = file.split('.').pop() || 'mp4'
        const { videoId, targetPath, renamed, reason } = await resolveInputTargetPath(stem, ext, oldPath, 'polling_watchfolder')
        if (renamed) {
          const detail = reason === 'random_uuid' ? 'Generated random VIDEO_ID' : 'Sanitized VIDEO_ID'
          log(`🧼 ${detail} polling_watchfolder: '${stem}' -> '${videoId}'`)
        }
        enqueue(videoId, targetPath, 'polling_watchfolder')
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

  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    if (watcher) watcher.kill('SIGTERM')
    if (poller) poller.stop()
    for (const child of activeChildren) {
      try { child.kill('SIGTERM') } catch {}
    }
    log('Shutting down pipeline watcher')
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
