import type { OfflineManifestFile, OfflineRendition } from '@vmp/shared'
import { trackOfflineEvent } from './analytics'
import { deviceAuthHeaders, ensureOfflineDevice } from './device'
import {
  dequeueDownload,
  deleteStoredDownload,
  enqueueDownload,
  listQueuedDownloads,
  listStoredDownloads,
  readStoredDevice,
  readStoredDownload,
  writeStoredDownload,
} from './idb'
import {
  buildOfflineMasterPlaylist,
  rewritePlaylistForOffline,
} from './localManifest'
import { isLicenseRevalidationDue } from './licenseClient'
import {
  deleteOfflineVideo,
  estimateOfflineBytes,
  readOfflineAsset,
  writeOfflineAsset,
} from './opfsStore'
import type {
  DownloadProgress,
  RenewLicenseResult,
  StoredDownload,
} from './types'

type ProgressListener = (progress: DownloadProgress) => void

const activeDownloads = new Map<string, AbortController>()
const progressListeners = new Map<string, Set<ProgressListener>>()

function nowIso(): string {
  return new Date().toISOString()
}

function emitProgress(videoId: string, record: StoredDownload): void {
  const listeners = progressListeners.get(videoId)
  if (!listeners?.size) return
  const payload: DownloadProgress = {
    videoId,
    status: record.status,
    bytesDownloaded: record.bytesDownloaded,
    totalBytes: record.totalBytes,
    filesCompleted: record.filesCompleted,
    filesTotal: record.filesTotal,
    errorMessage: record.errorMessage,
  }
  for (const listener of listeners) listener(payload)
}

export function subscribeDownloadProgress(
  videoId: string,
  listener: ProgressListener,
): () => void {
  const set = progressListeners.get(videoId) ?? new Set()
  set.add(listener)
  progressListeners.set(videoId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) progressListeners.delete(videoId)
  }
}

async function patchDownload(
  videoId: string,
  patch: Partial<StoredDownload>,
): Promise<StoredDownload> {
  const current = await readStoredDownload(videoId)
  if (!current) throw new Error('Download record missing')
  const next: StoredDownload = { ...current, ...patch, updatedAt: nowIso() }
  await writeStoredDownload(next)
  emitProgress(videoId, next)
  return next
}

function isGeneratedManifestPath(path: string): boolean {
  return path === 'offline-master.m3u8'
    || path === 'offline-audio.m3u8'
    || path.endsWith('/offline-playlist.m3u8')
}

function findSourcePlaylist(files: OfflineManifestFile[], rendition: OfflineRendition): string | null {
  const candidates = [
    `${rendition}/playlist.m3u8`,
    `${rendition}/index.m3u8`,
    'playlist.m3u8',
  ]
  const paths = new Set(files.map(f => f.path))
  return candidates.find(c => paths.has(c)) ?? null
}

function findAudioPlaylist(files: OfflineManifestFile[]): string | null {
  const candidates = ['audio/playlist.m3u8', 'audio/index.m3u8', 'audio.m3u8']
  const paths = new Set(files.map(f => f.path))
  return candidates.find(c => paths.has(c)) ?? null
}

async function buildGeneratedManifests(
  videoId: string,
  rendition: OfflineRendition,
  files: OfflineManifestFile[],
): Promise<Array<{ path: string, bytes: Uint8Array }>> {
  const generated: Array<{ path: string, bytes: Uint8Array }> = []
  const encoder = new TextEncoder()

  const variantSource = findSourcePlaylist(files, rendition)
  const audioSource = findAudioPlaylist(files)
  let hasAudio = false

  if (audioSource) {
    const audioBytes = await readOfflineAsset(videoId, audioSource)
    if (audioBytes) {
      const audioText = new TextDecoder().decode(audioBytes)
      const rewritten = rewritePlaylistForOffline(audioText, videoId, audioSource)
      generated.push({
        path: 'offline-audio.m3u8',
        bytes: encoder.encode(rewritten),
      })
      hasAudio = true
    }
  }

  if (variantSource) {
    const variantBytes = await readOfflineAsset(videoId, variantSource)
    if (variantBytes) {
      const variantText = new TextDecoder().decode(variantBytes)
      const rewritten = rewritePlaylistForOffline(variantText, videoId, variantSource)
      generated.push({
        path: `${rendition}/offline-playlist.m3u8`,
        bytes: encoder.encode(rewritten),
      })
    }
  }

  generated.push({
    path: 'offline-master.m3u8',
    bytes: encoder.encode(buildOfflineMasterPlaylist(videoId, rendition, hasAudio)),
  })

  return generated
}

async function fetchAsset(
  apiUrl: string,
  videoId: string,
  path: string,
  downloadToken: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const url = `${apiUrl}/api/downloads/${encodeURIComponent(videoId)}/assets/${path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')}?dt=${encodeURIComponent(downloadToken)}`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Failed to download ${path}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

export async function startOfflineDownload({
  apiUrl,
  authHeaders,
  videoId,
  rendition,
}: {
  apiUrl: string
  authHeaders: Record<string, string>
  videoId: string
  rendition: OfflineRendition
}): Promise<void> {
  if (activeDownloads.has(videoId)) return

  const device = await ensureOfflineDevice(apiUrl, authHeaders)
  const controller = new AbortController()
  activeDownloads.set(videoId, controller)

  const initial: StoredDownload = {
    videoId,
    videoTitle: '',
    rendition,
    status: 'downloading',
    license: {
      licenseId: '',
      deviceId: device.deviceId,
      videoId,
      rendition,
      expiresAt: new Date().toISOString(),
      manifestHash: '',
      manifestVersion: 1,
      playbackState: 'allowed',
      nextValidationDueAt: new Date().toISOString(),
      signature: '',
    },
    downloadToken: '',
    manifestHash: '',
    manifestVersion: 1,
    bytesDownloaded: 0,
    totalBytes: 0,
    filesCompleted: 0,
    filesTotal: 0,
    errorMessage: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
  }
  await writeStoredDownload(initial)
  await enqueueDownload(videoId)
  emitProgress(videoId, initial)
  trackOfflineEvent('offline_download_started', { videoId, rendition })

  try {
    const res = await fetch(`${apiUrl}/api/downloads/${encodeURIComponent(videoId)}/authorize`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...deviceAuthHeaders(device),
      },
      body: JSON.stringify({ rendition, deviceId: device.deviceId }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Download authorization failed')

    const downloadableFiles = data.manifest.files.filter(
      (f: OfflineManifestFile) => !isGeneratedManifestPath(f.path),
    )
    const totalBytes = data.estimatedBytes ?? data.manifest.totalBytes ?? 0

    await patchDownload(videoId, {
      videoTitle: data.video?.title ?? videoId,
      license: data.license,
      downloadToken: data.downloadToken,
      manifestHash: data.license.manifestHash,
      manifestVersion: data.license.manifestVersion,
      totalBytes,
      filesTotal: downloadableFiles.length,
      filesCompleted: 0,
      bytesDownloaded: 0,
      status: 'downloading',
      errorMessage: null,
    })

    let bytesDownloaded = 0
    let filesCompleted = 0

    for (const file of downloadableFiles) {
      controller.signal.throwIfAborted()
      const bytes = await fetchAsset(apiUrl, videoId, file.path, data.downloadToken, controller.signal)
      await writeOfflineAsset(videoId, file.path, bytes)
      bytesDownloaded += bytes.byteLength
      filesCompleted += 1
      await patchDownload(videoId, {
        bytesDownloaded,
        filesCompleted,
      })
    }

    const generated = await buildGeneratedManifests(videoId, rendition, data.manifest.files)
    for (const item of generated) {
      await writeOfflineAsset(videoId, item.path, item.bytes)
      bytesDownloaded += item.bytes.byteLength
    }

    await patchDownload(videoId, {
      status: 'completed',
      bytesDownloaded,
      filesCompleted: downloadableFiles.length,
      completedAt: nowIso(),
      errorMessage: null,
    })
    await dequeueDownload(videoId)
    trackOfflineEvent('offline_download_completed', {
      videoId,
      rendition,
      bytesDownloaded,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Download failed'
    if (controller.signal.aborted) {
      await patchDownload(videoId, { status: 'paused', errorMessage: null })
    } else {
      await patchDownload(videoId, { status: 'failed', errorMessage: message })
      trackOfflineEvent('offline_download_failed', { videoId, rendition, message })
    }
    throw err
  } finally {
    activeDownloads.delete(videoId)
  }
}

export async function pauseOfflineDownload(videoId: string): Promise<void> {
  const controller = activeDownloads.get(videoId)
  controller?.abort()
  activeDownloads.delete(videoId)
  const record = await readStoredDownload(videoId)
  if (record && record.status === 'downloading') {
    await patchDownload(videoId, { status: 'paused' })
  }
}

export async function removeOfflineDownload(
  apiUrl: string,
  authHeaders: Record<string, string>,
  videoId: string,
): Promise<void> {
  await pauseOfflineDownload(videoId)
  await fetch(`${apiUrl}/api/downloads/${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({}),
  }).catch(() => {})
  await deleteOfflineVideo(videoId)
  await deleteStoredDownload(videoId)
  await dequeueDownload(videoId)
  trackOfflineEvent('offline_download_removed', { videoId })
}

export async function revalidateOfflineLicenses(
  apiUrl: string,
): Promise<RenewLicenseResult[]> {
  const device = await readStoredDevice()
  if (!device) return []

  const downloads = await listStoredDownloads()
  const due = downloads.filter(
    d => d.status === 'completed' && isLicenseRevalidationDue(d.license),
  )
  if (due.length === 0) return []

  const licenseIds = due.map(d => d.license.licenseId).filter(Boolean)
  if (licenseIds.length === 0) return []

  const res = await fetch(`${apiUrl}/api/downloads/licenses/renew`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...deviceAuthHeaders(device),
    },
    body: JSON.stringify({ licenseIds }),
  })
  const data = await res.json().catch(() => ({ results: [] }))
  if (!res.ok) return []

  const results: RenewLicenseResult[] = data.results ?? []
  for (const result of results) {
    const record = downloads.find(d => d.license.licenseId === result.licenseId)
    if (!record) continue
    if (result.status === 'renewed' && result.license) {
      await patchDownload(record.videoId, {
        license: result.license,
        status: record.status === 'update_available' ? 'update_available' : 'completed',
      })
    } else if (result.status === 'revoked') {
      await patchDownload(record.videoId, {
        license: {
          ...record.license,
          playbackState: 'revoked',
        },
        status: 'license_expired',
      })
    }
  }
  return results
}

export async function checkManifestUpdates(
  apiUrl: string,
  authHeaders: Record<string, string>,
): Promise<void> {
  const device = await readStoredDevice()
  if (!device) return

  const downloads = await listStoredDownloads()
  for (const record of downloads) {
    if (record.status !== 'completed' && record.status !== 'update_available') continue
    try {
      const res = await fetch(`${apiUrl}/api/downloads/${encodeURIComponent(record.videoId)}/authorize`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
          ...deviceAuthHeaders(device),
        },
        body: JSON.stringify({
          rendition: record.rendition,
          deviceId: device.deviceId,
        }),
      })
      if (!res.ok) continue
      const data = await res.json()
      if (data.license?.manifestVersion > record.manifestVersion
        || data.license?.manifestHash !== record.manifestHash) {
        await patchDownload(record.videoId, {
          status: 'update_available',
          manifestVersion: data.license.manifestVersion,
          manifestHash: data.license.manifestHash,
        })
      }
    } catch {
      // best effort
    }
  }
}

export async function resumeQueuedDownloads(
  apiUrl: string,
  authHeaders: Record<string, string>,
): Promise<void> {
  const queued = await listQueuedDownloads()
  const downloads = await listStoredDownloads()
  for (const videoId of queued) {
    const record = downloads.find(d => d.videoId === videoId)
    if (!record) {
      await dequeueDownload(videoId)
      continue
    }
    if (record.status === 'paused' || record.status === 'failed') {
      await startOfflineDownload({
        apiUrl,
        authHeaders,
        videoId,
        rendition: record.rendition,
      }).catch(() => {})
    }
  }
}

export async function getStorageSummary(): Promise<{
  usedBytes: number
  quotaBytes: number | null
  downloadCount: number
}> {
  const downloads = await listStoredDownloads()
  let usedBytes = 0
  for (const record of downloads) {
    if (record.status === 'completed' || record.status === 'update_available') {
      usedBytes += await estimateOfflineBytes(record.videoId)
    } else {
      usedBytes += record.bytesDownloaded
    }
  }
  let quotaBytes: number | null = null
  try {
    const estimate = await navigator.storage.estimate()
    quotaBytes = estimate.quota ?? null
  } catch {
    quotaBytes = null
  }
  return {
    usedBytes,
    quotaBytes,
    downloadCount: downloads.filter(d => d.status === 'completed' || d.status === 'update_available').length,
  }
}

export function isDownloadActive(videoId: string): boolean {
  return activeDownloads.has(videoId)
}

export async function getDownloadRecord(videoId: string): Promise<StoredDownload | null> {
  return readStoredDownload(videoId)
}

export async function listDownloadRecords(): Promise<StoredDownload[]> {
  return listStoredDownloads()
}
