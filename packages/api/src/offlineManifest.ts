/**
 * Build a flat file list for a single HLS rendition + shared audio group.
 */

export type OfflineRendition = '480p' | '720p' | '1080p'

export interface OfflineManifestFile {
  /** Path relative to videos/{videoId}/ — e.g. "720p/seg_720_001.m4s" */
  path: string
  size: number | null
}

export interface OfflineManifest {
  videoId: string
  rendition: OfflineRendition
  files: OfflineManifestFile[]
  totalBytes: number
  manifestVersion: number
}

const RENDITION_RESOLUTION: Record<OfflineRendition, string> = {
  '480p': '854x480',
  '720p': '1280x720',
  '1080p': '1920x1080',
}

export function isOfflineRendition(value: unknown): value is OfflineRendition {
  return value === '480p' || value === '720p' || value === '1080p'
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
  r2BaseUrl,
  videoId,
  rendition,
  manifestVersion = 1,
}: {
  r2BaseUrl: string
  videoId: string
  rendition: OfflineRendition
  manifestVersion?: number
}): Promise<OfflineManifest> {
  const base = r2BaseUrl.replace(/\/+$/, '')
  const prefix = `${base}/videos/${encodeURIComponent(videoId)}/`

  const masterCandidates = [
    `${prefix}master.m3u8`,
    `${prefix}processed/hls/master.m3u8`,
    `${prefix}processed/playlist.m3u8`,
  ]

  let masterUrl: string | null = null
  for (const candidate of masterCandidates) {
    if (await headOk(candidate)) {
      masterUrl = candidate
      break
    }
  }
  if (!masterUrl) {
    throw new Error('No HLS master playlist found in R2 for this video')
  }

  const masterText = await fetchText(masterUrl)
  const variantPlaylistUrl = pickVariantPlaylistUrl(masterText, masterUrl, rendition)
  if (!variantPlaylistUrl) {
    throw new Error(`Rendition ${rendition} is not available for this video`)
  }

  const files: OfflineManifestFile[] = []
  const seen = new Set<string>()

  const addRelativePath = async (absoluteOrRelative: string, fromUrl: string) => {
    const resolved = new URL(absoluteOrRelative, fromUrl)
    const relative = toVideoRelativePath(resolved.pathname, videoId)
    if (!relative || seen.has(relative)) return
    seen.add(relative)
    const size = await headContentLength(`${base}/videos/${videoId}/${relative}`)
    files.push({ path: relative, size })
  }

  const audioPlaylistUrl = findAudioPlaylistUrl(masterText, masterUrl)
  if (audioPlaylistUrl) {
    const audioText = await fetchText(audioPlaylistUrl)
    await collectMediaPlaylistFiles(audioText, audioPlaylistUrl, addRelativePath)
  }

  const variantText = await fetchText(variantPlaylistUrl)
  await collectMediaPlaylistFiles(variantText, variantPlaylistUrl, addRelativePath)

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

function pickVariantPlaylistUrl(masterText: string, masterUrl: string, rendition: OfflineRendition): string | null {
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
      return new URL(next, masterUrl).toString()
    }
  }

  // Phase-1 videos may only expose 720p without RESOLUTION tag
  if (rendition === '720p') {
    for (let i = 0; i < lines.length; i++) {
      const streamInf = lines[i]
      if (!streamInf?.startsWith('#EXT-X-STREAM-INF:')) continue
      const next = lines[i + 1]
      if (next && !next.startsWith('#')) return new URL(next, masterUrl).toString()
    }
  }

  return null
}

function findAudioPlaylistUrl(masterText: string, masterUrl: string): string | null {
  const lines = masterText.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue
    if (!/TYPE=AUDIO/i.test(line)) continue
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

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function headContentLength(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
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
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch playlist (${res.status})`)
  return res.text()
}

export function estimateDownloadBytes(durationSec: number, rendition: OfflineRendition): number {
  const videoBitrate = { '480p': 1.5e6, '720p': 3e6, '1080p': 5e6 }[rendition]
  const audioBitrate = rendition === '480p' ? 96e3 : 128e3
  return Math.ceil((videoBitrate + audioBitrate) * Math.max(0, durationSec) / 8 * 1.05)
}
