import type { OfflineRendition } from '@vmp/shared'
import { OFFLINE_MEDIA_URL_PREFIX } from './constants'

const RENDITION_RESOLUTION: Record<OfflineRendition, string> = {
  '480p': '854x480',
  '720p': '1280x720',
  '1080p': '1920x1080',
}

const RENDITION_BANDWIDTH: Record<OfflineRendition, number> = {
  '480p': 1_500_000,
  '720p': 3_000_000,
  '1080p': 5_000_000,
}

export function offlineMediaUrl(videoId: string, relativePath: string): string {
  const encodedVideo = encodeURIComponent(videoId)
  const encodedPath = relativePath
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return `${OFFLINE_MEDIA_URL_PREFIX}${encodedVideo}/${encodedPath}`
}

export function rewritePlaylistForOffline(
  playlistText: string,
  videoId: string,
  playlistBasePath: string,
): string {
  const baseDir = playlistBasePath.includes('/')
    ? playlistBasePath.slice(0, playlistBasePath.lastIndexOf('/'))
  : ''

  const resolveRelative = (uri: string): string => {
    const trimmed = uri.trim()
    if (!trimmed || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed
    }
    if (trimmed.startsWith('/')) {
      const normalized = trimmed
        .replace(/^\/+/, '')
        .split('/')
        .filter(part => part && part !== '.')
        .reduce<string[]>((acc, part) => {
          if (part === '..') {
            acc.pop()
            return acc
          }
          acc.push(part)
          return acc
        }, [])
        .join('/')
      return offlineMediaUrl(videoId, normalized)
    }
    const combined = baseDir ? `${baseDir}/${trimmed}` : trimmed
    const normalized = combined
      .split('/')
      .filter(part => part && part !== '.')
      .reduce<string[]>((acc, part) => {
        if (part === '..') {
          acc.pop()
          return acc
        }
        acc.push(part)
        return acc
      }, [])
      .join('/')
    return offlineMediaUrl(videoId, normalized)
  }

  const lines = playlistText.split('\n')
  return lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return line
    if (trimmed.startsWith('#')) {
      const mapMatch = trimmed.match(/URI="([^"]+)"/i)
      if (mapMatch?.[1]) {
        return trimmed.replace(mapMatch[1], resolveRelative(mapMatch[1]))
      }
      return line
    }
    return resolveRelative(trimmed)
  }).join('\n')
}

export function buildOfflineMasterPlaylist(
  videoId: string,
  rendition: OfflineRendition,
  hasAudio: boolean,
): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
  ]
  if (hasAudio) {
    lines.push(
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,URI="offline-audio.m3u8"',
    )
  }
  const audioAttr = hasAudio ? ',AUDIO="audio"' : ''
  lines.push(
    `#EXT-X-STREAM-INF:BANDWIDTH=${RENDITION_BANDWIDTH[rendition]},RESOLUTION=${RENDITION_RESOLUTION[rendition]}${audioAttr}`,
    offlineMediaUrl(videoId, `${rendition}/offline-playlist.m3u8`),
  )
  return lines.join('\n') + '\n'
}

export function masterPlaylistUrl(videoId: string): string {
  return offlineMediaUrl(videoId, 'offline-master.m3u8')
}
