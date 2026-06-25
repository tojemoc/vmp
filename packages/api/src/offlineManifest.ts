/**
 * Build a flat file list for a single HLS rendition + shared audio group.
 */

import type {
  OfflineManifest,
  OfflineManifestFile,
  OfflineRendition,
} from '@vmp/shared'
export { isOfflineRendition } from '@vmp/shared'

const RENDITION_RESOLUTION: Record<OfflineRendition, string> = {
  '480p': '854x480',
  '720p': '1280x720',
  '1080p': '1920x1080',
}

const MASTER_RELATIVE_CANDIDATES = [
  'master.m3u8',
  'processed/hls/master.m3u8',
  'processed/playlist.m3u8',
]

const R2_PROBE_TIMEOUT_MS = 8_000

export interface OfflineR2Reader {
  /** Synthetic absolute URL for resolving relative playlist URIs. */
  masterBaseUrl(masterRelativePath: string): string
  exists(relativePath: string): Promise<boolean>
  readText(relativePath: string): Promise<string>
  contentLength(relativePath: string): Promise<number | null>
}

export function createBucketOfflineR2Reader(bucket: R2Bucket, videoId: string): OfflineR2Reader {
  const keyPrefix = `videos/${videoId}/`

  return {
    masterBaseUrl(masterRelativePath) {
      return `https://r2.local/${keyPrefix}${masterRelativePath}`
    },
    async exists(relativePath) {
      const object = await bucket.head(`${keyPrefix}${relativePath}`)
      return object !== null
    },
    async readText(relativePath) {
      const object = await bucket.get(`${keyPrefix}${relativePath}`)
      if (!object) throw new Error(`Playlist not found in R2: ${relativePath}`)
      return object.text()
    },
    async contentLength(relativePath) {
      const object = await bucket.head(`${keyPrefix}${relativePath}`)
      if (!object) return null
      return Number.isFinite(object.size) ? object.size : null
    },
  }
}

export function createHttpOfflineR2Reader(r2BaseUrl: string, videoId: string): OfflineR2Reader {
  const publicPrefix = `${r2BaseUrl.replace(/\/+$/, '')}/videos/${encodeURIComponent(videoId)}/`

  return {
    masterBaseUrl(masterRelativePath) {
      return `${publicPrefix}${masterRelativePath}`
    },
    async exists(relativePath) {
      return headOk(`${publicPrefix}${relativePath}`)
    },
    async readText(relativePath) {
      return fetchText(`${publicPrefix}${relativePath}`)
    },
    async contentLength(relativePath) {
      return headContentLength(`${publicPrefix}${relativePath}`)
    },
  }
}

export function computeManifestHash(files: OfflineManifestFile[]): string {
  const canonical = files
    .map(f => `${f.path}:${f.size ?? 0}`)
    .sort()
    .join('\n')
  return canonical
}

export async function sha256HexFromString(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('')
}

export async function buildOfflineManifest({
  reader,
  videoId,
  rendition,
  manifestVersion = 1,
}: {
  reader: OfflineR2Reader
  videoId: string
  rendition: OfflineRendition
  manifestVersion?: number
}): Promise<OfflineManifest> {
  let masterRelative: string | null = null
  for (const candidate of MASTER_RELATIVE_CANDIDATES) {
    if (await reader.exists(candidate)) {
      masterRelative = candidate
      break
    }
  }
  if (!masterRelative) {
    throw new Error('No HLS master playlist found in R2 for this video')
  }

  const masterUrl = reader.masterBaseUrl(masterRelative)
  const masterText = await reader.readText(masterRelative)
  const variantSelection = pickVariantPlaylistUrl(masterText, masterUrl, rendition)
  if (!variantSelection) {
    throw new Error(`Rendition ${rendition} is not available for this video`)
  }

  const files: OfflineManifestFile[] = []
  const seen = new Set<string>()

  const addRelativePath = async (absoluteOrRelative: string, fromUrl: string) => {
    const resolved = new URL(absoluteOrRelative, fromUrl)
    const relative = toVideoRelativePath(resolved.pathname, videoId)
    if (!relative || seen.has(relative)) return
    seen.add(relative)
    const size = await reader.contentLength(relative)
    files.push({ path: relative, size })
  }

  const audioPlaylistUrl = findAudioPlaylistUrl(masterText, masterUrl, variantSelection.audioGroupId)
  if (audioPlaylistUrl) {
    const audioRelative = toVideoRelativePath(new URL(audioPlaylistUrl).pathname, videoId)
    if (audioRelative) {
      const audioText = await reader.readText(audioRelative)
      await collectMediaPlaylistFiles(audioText, audioPlaylistUrl, addRelativePath)
    }
  }

  const variantRelative = toVideoRelativePath(new URL(variantSelection.playlistUrl).pathname, videoId)
  if (!variantRelative) {
    throw new Error(`Rendition ${rendition} playlist path is invalid for this video`)
  }
  const variantText = await reader.readText(variantRelative)
  await collectMediaPlaylistFiles(variantText, variantSelection.playlistUrl, addRelativePath)

  if (variantRelative && !seen.has(variantRelative)) {
    seen.add(variantRelative)
    const size = await reader.contentLength(variantRelative)
    files.push({ path: variantRelative, size })
  }

  if (audioPlaylistUrl) {
    const audioRelative = toVideoRelativePath(new URL(audioPlaylistUrl).pathname, videoId)
    if (audioRelative && !seen.has(audioRelative)) {
      seen.add(audioRelative)
      const size = await reader.contentLength(audioRelative)
      files.push({ path: audioRelative, size })
    }
  }

  if (!seen.has(masterRelative)) {
    seen.add(masterRelative)
    const size = await reader.contentLength(masterRelative)
    files.push({ path: masterRelative, size })
  }

  // Include rewritten local manifests the client will store
  const localManifestPaths = [
    'offline-master.m3u8',
    `${rendition}/offline-playlist.m3u8`,
  ]
  if (audioPlaylistUrl) localManifestPaths.push('offline-audio.m3u8')
  for (const path of localManifestPaths) {
    if (!seen.has(path)) {
      seen.add(path)
      files.push({ path, size: null })
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + (f.size ?? 0), 0)

  return {
    videoId,
    rendition,
    files,
    totalBytes,
    manifestVersion,
  }
}

interface VariantSelection {
  playlistUrl: string
  audioGroupId: string | null
}

function pickVariantPlaylistUrl(
  masterText: string,
  masterUrl: string,
  rendition: OfflineRendition,
): VariantSelection | null {
  const lines = masterText.split('\n').map(l => l.trim()).filter(Boolean)
  const targetResolution = RENDITION_RESOLUTION[rendition]
  const targetPathFragment = `/${rendition}/`

  for (let i = 0; i < lines.length; i++) {
    const streamInf = lines[i]
    if (!streamInf?.startsWith('#EXT-X-STREAM-INF:')) continue
    const next = lines[i + 1]
    if (!next || next.startsWith('#')) continue

    const resolutionMatch = streamInf.match(/RESOLUTION=(\d+x\d+)/i)
    const resolution = resolutionMatch?.[1]
    const matchesResolution = resolution === targetResolution
    const matchesPath = next.includes(targetPathFragment) || next.includes(`${rendition}/playlist.m3u8`)
    if (matchesResolution || matchesPath) {
      return {
        playlistUrl: new URL(next, masterUrl).toString(),
        audioGroupId: extractAudioGroupId(streamInf),
      }
    }
  }

  // Phase-1 videos may only expose 720p without RESOLUTION tag
  if (rendition === '720p') {
    for (let i = 0; i < lines.length; i++) {
      const streamInf = lines[i]
      if (!streamInf?.startsWith('#EXT-X-STREAM-INF:')) continue
      const next = lines[i + 1]
      if (next && !next.startsWith('#')) {
        return {
          playlistUrl: new URL(next, masterUrl).toString(),
          audioGroupId: extractAudioGroupId(streamInf),
        }
      }
    }
  }

  return null
}

function extractAudioGroupId(streamInfLine: string): string | null {
  const match = streamInfLine.match(/AUDIO="([^"]+)"/i)
  return match?.[1] ?? null
}

export function findAudioPlaylistUrl(
  masterText: string,
  masterUrl: string,
  audioGroupId: string | null,
): string | null {
  const lines = masterText.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue
    if (!/TYPE=AUDIO/i.test(line)) continue
    if (audioGroupId) {
      const groupMatch = line.match(/GROUP-ID="([^"]+)"/i)
      if (groupMatch?.[1] !== audioGroupId) continue
    }
    const uriMatch = line.match(/URI="([^"]+)"/i)
    if (uriMatch?.[1]) return new URL(uriMatch[1], masterUrl).toString()
  }
  return null
}

async function collectMediaPlaylistFiles(
  playlistText: string,
  playlistUrl: string,
  addFile: (uri: string, fromUrl: string) => Promise<void>,
) {
  const lines = playlistText.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) {
      const uriMatch = line.match(/URI="([^"]+)"/i)
      if (uriMatch?.[1]) await addFile(uriMatch[1], playlistUrl)
      continue
    }
    if (line.startsWith('#')) continue
    await addFile(line, playlistUrl)
  }
}

function toVideoRelativePath(pathname: string, videoId: string): string | null {
  const decoded = decodeURIComponent(pathname.replace(/^\/+/, ''))
  const prefix = `videos/${videoId}/`
  if (!decoded.startsWith(prefix)) return null
  const relative = decoded.slice(prefix.length)
  if (!relative || relative.includes('..')) return null
  return relative
}

function probeSignal(): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(R2_PROBE_TIMEOUT_MS)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), R2_PROBE_TIMEOUT_MS)
  return controller.signal
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: probeSignal() })
    return res.ok
  } catch {
    return false
  }
}

async function headContentLength(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: probeSignal() })
    if (!res.ok) return null
    const cl = res.headers.get('Content-Length')
    if (!cl) return null
    const n = Number.parseInt(cl, 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

async function fetchText(url: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, { signal: probeSignal() })
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error('Timed out fetching playlist from R2')
    }
    throw new Error('Failed to fetch playlist from R2')
  }
  if (!res.ok) throw new Error(`Failed to fetch playlist (${res.status})`)
  return res.text()
}

export function estimateDownloadBytes(durationSec: number, rendition: OfflineRendition): number {
  const videoBitrate = { '480p': 1.5e6, '720p': 3e6, '1080p': 5e6 }[rendition]
  const audioBitrate = rendition === '480p' ? 96e3 : 128e3
  return Math.ceil((videoBitrate + audioBitrate) * Math.max(0, durationSec) / 8 * 1.05)
}

export function parseLicensedManifestPaths(raw: unknown): Set<string> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    for (const entry of parsed) {
      if (typeof entry !== 'string' || entry.length === 0) return null
    }
    return new Set(parsed)
  } catch {
    return null
  }
}
