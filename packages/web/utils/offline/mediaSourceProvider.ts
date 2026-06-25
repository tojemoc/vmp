import type { OfflineRendition } from '@vmp/shared'
import { isLicensePlaybackAllowed } from './licenseClient'
import { masterPlaylistUrl } from './localManifest'
import { readStoredDownload } from './idb'
import type { MediaSourceResult } from './types'

export async function getOfflinePlaylistUrl(videoId: string): Promise<MediaSourceResult | null> {
  if (import.meta.server) return null
  const record = await readStoredDownload(videoId)
  if (!record || (record.status !== 'completed' && record.status !== 'update_available')) return null
  if (!isLicensePlaybackAllowed(record.license)) return null
  return {
    playlistUrl: masterPlaylistUrl(videoId),
    source: 'offline',
    license: record.license,
  }
}

export function pickDefaultRendition(): OfflineRendition {
  return '720p'
}
