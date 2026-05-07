#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'

let activeChild: ChildProcessWithoutNullStreams | null = null

function env(name: string, fallback = ''): string {
  const value = process.env[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function parseArgs(): { videoId: string, previewSeconds: number } {
  const [, , rawVideoId, rawSeconds] = process.argv
  if (!rawVideoId) throw new Error('Usage: node dist/render_podcast_preview_mp3.js <video_id> <preview_seconds>')
  if (!/^[a-zA-Z0-9._-]+$/.test(rawVideoId)) throw new Error('video_id contains invalid characters')
  const seconds = Number.parseInt(String(rawSeconds ?? ''), 10)
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('preview_seconds must be a positive integer')
  return { videoId: rawVideoId, previewSeconds: Math.floor(seconds) }
}

function buildR2Root(): string {
  const rcloneRemote = env('RCLONE_REMOTE')
  const bucketName = env('R2_BUCKET_NAME')
  const bucket = env('R2_BUCKET', 'vmp-videos')
  if (rcloneRemote) return bucketName ? `${rcloneRemote}:${bucketName}` : `${rcloneRemote}:`
  return bucket.includes(':') ? bucket : `${bucket}:`
}

function r2Path(root: string, relativePath: string): string {
  return `${root.replace(/\/+$/, '')}/${String(relativePath).replace(/^\/+/, '')}`
}

function run(command: string, args: readonly string[], label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    activeChild = child
    let stderr = ''
    child.stdout.on('data', (chunk) => process.stdout.write(chunk))
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (activeChild === child) activeChild = null
      if (code === 0) return resolve(undefined)
      reject(new Error(`${label} failed with exit ${code}: ${stderr.slice(-400)}`))
    })
  })
}

async function runCapture(command: string, args: readonly string[], label: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    activeChild = child
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (activeChild === child) activeChild = null
      if (code === 0) return resolve(stdout)
      reject(new Error(`${label} failed with exit ${code}: ${stderr.slice(-400)}`))
    })
  })
}

async function copyFirstAvailableSource(root: string, videoId: string, localIn: string): Promise<string> {
  const candidates = [
    r2Path(root, `videos/${videoId}/podcast.mp3`),
    r2Path(root, `videos/${videoId}/processed/audio/podcast.mp3`),
    r2Path(root, `videos/${videoId}/processed/podcast.mp3`),
  ]
  let lastErr = null
  for (const remote of candidates) {
    try {
      await run('rclone', ['copyto', remote, localIn], `rclone copyto (${remote})`)
      return remote
    } catch (err) {
      lastErr = err
      // Try next candidate
    }
  }
  const detail = lastErr instanceof Error ? ` Last error: ${lastErr.message}` : ''
  throw new Error(`Could not locate source podcast MP3 in R2 for video ${videoId}.${detail}`)
}

async function main() {
  const { videoId, previewSeconds } = parseArgs()
  const mp3Bitrate = env('MP3_BITRATE', '128k')
  const root = buildR2Root()

  const tempDir = await mkdtemp(path.join(tmpdir(), `vmp_podcast_preview_${videoId}_`))
  const localIn = path.join(tempDir, 'podcast.mp3')
  const localOut = path.join(tempDir, 'podcast_preview.mp3')
  const localMeta = path.join(tempDir, 'podcast_preview.meta.json')
  let cleaning = false
  const cleanupTempDir = async () => {
    if (cleaning) return
    cleaning = true
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
  const onSigterm = () => {
    if (activeChild) {
      try { activeChild.kill('SIGTERM') } catch {}
      setTimeout(() => {
        if (activeChild) {
          try { activeChild.kill('SIGKILL') } catch {}
        }
      }, 1500)
    }
    void cleanupTempDir().finally(() => process.exit(143))
  }
  process.on('SIGTERM', onSigterm)

  try {
    const sourceUsed = await copyFirstAvailableSource(root, videoId, localIn)
    console.log(`[preview] source=${sourceUsed}`)

    await run(
      'ffmpeg',
      ['-hide_banner', '-y', '-i', localIn, '-t', String(previewSeconds), '-vn', '-c:a', 'libmp3lame', '-b:a', mp3Bitrate, '-f', 'mp3', localOut],
      'ffmpeg preview render',
    )

    const ffprobeRaw = await runCapture(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', localOut],
      'ffprobe preview duration',
    )
    const measuredDurationSeconds = Number.parseFloat(ffprobeRaw.trim())
    if (!Number.isFinite(measuredDurationSeconds) || measuredDurationSeconds <= 0) {
      throw new Error('Failed to validate rendered preview duration')
    }
    const roundedDuration = Math.max(1, Math.round(measuredDurationSeconds))
    if (roundedDuration > previewSeconds + 1) {
      throw new Error(`Trimmed preview is too long (${roundedDuration}s > ${previewSeconds}s)`)
    }
    await writeFile(localMeta, JSON.stringify({
      videoId,
      requestedPreviewSeconds: previewSeconds,
      measuredDurationSeconds: roundedDuration,
      renderedAt: new Date().toISOString(),
    }))

    await run('rclone', ['copyto', localOut, r2Path(root, `videos/${videoId}/podcast_preview.mp3`)], 'rclone preview upload')
    await run('rclone', ['copyto', localMeta, r2Path(root, `videos/${videoId}/podcast_preview.meta.json`)], 'rclone preview metadata upload')
    console.log(`[preview] done video=${videoId} seconds=${previewSeconds}`)
  } finally {
    process.off('SIGTERM', onSigterm)
    await cleanupTempDir()
  }
}

main().catch((err) => {
  console.error(`[preview] failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
