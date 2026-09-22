import type { OfflineManifestFile, OfflineRendition } from '@vmp/shared';
import {
  authorizeOfflineDownload,
  buildOfflineAssetUrl,
  revokeOfflineDownload,
} from '../api/client';
import { deviceAuthHeaders, ensureOfflineDevice, readStoredDevice } from './device';
import { isLicensePlaybackAllowed, isLicenseRevalidationDue } from './licenseClient';
import { buildOfflineMasterPlaylist, rewritePlaylistForOfflineRelative } from './localManifest';
import { buildOfflinePlaybackHttpUrl, ensureOfflinePlaybackServer } from './playbackServer';
import {
  assetExists,
  deleteOfflineVideo,
  deleteStoredDownload,
  downloadRemoteAsset,
  listStoredDownloads,
  readAssetText,
  readStoredDownload,
  writeAssetText,
  writeStoredDownload,
} from './storage';
import type { DownloadProgress, StoredDownload } from './types';

type ProgressListener = (progress: DownloadProgress) => void;

type ActiveDownload = {
  userId: string;
  controller: AbortController;
  /** Settles with the task outcome (rejects on failure; resolves on success). */
  promise: Promise<void>;
};

const activeDownloads = new Map<string, ActiveDownload>();
const progressListeners = new Map<string, Set<ProgressListener>>();

function nowIso(): string {
  return new Date().toISOString();
}

function emitProgress(videoId: string, record: StoredDownload): void {
  const listeners = progressListeners.get(videoId);
  if (!listeners?.size) return;
  const payload: DownloadProgress = {
    videoId,
    userId: record.userId,
    status: record.status,
    bytesDownloaded: record.bytesDownloaded,
    totalBytes: record.totalBytes,
    filesCompleted: record.filesCompleted,
    filesTotal: record.filesTotal,
    errorMessage: record.errorMessage,
  };
  for (const listener of listeners) listener(payload);
}

export function subscribeDownloadProgress(videoId: string, listener: ProgressListener): () => void {
  const set = progressListeners.get(videoId) ?? new Set();
  set.add(listener);
  progressListeners.set(videoId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) progressListeners.delete(videoId);
  };
}

async function patchDownload(
  videoId: string,
  patch: Partial<StoredDownload>,
): Promise<StoredDownload> {
  const current = await readStoredDownload(videoId);
  if (!current) throw new Error('Download record missing');
  const next: StoredDownload = { ...current, ...patch, updatedAt: nowIso() };
  await writeStoredDownload(next);
  emitProgress(videoId, next);
  return next;
}

function isGeneratedManifestPath(path: string): boolean {
  return (
    path === 'offline-master.m3u8' ||
    path === 'offline-audio.m3u8' ||
    path.endsWith('/offline-playlist.m3u8')
  );
}

function findSourcePlaylist(
  files: OfflineManifestFile[],
  rendition: OfflineRendition,
): string | null {
  const candidates = [`${rendition}/playlist.m3u8`, `${rendition}/index.m3u8`, 'playlist.m3u8'];
  const paths = new Set(files.map((f) => f.path));
  return candidates.find((c) => paths.has(c)) ?? null;
}

function findAudioPlaylist(files: OfflineManifestFile[]): string | null {
  const candidates = ['audio/playlist.m3u8', 'audio/index.m3u8', 'audio.m3u8'];
  const paths = new Set(files.map((f) => f.path));
  return candidates.find((c) => paths.has(c)) ?? null;
}

async function buildGeneratedManifests(
  videoId: string,
  rendition: OfflineRendition,
  files: OfflineManifestFile[],
): Promise<Array<{ path: string; text: string }>> {
  const generated: Array<{ path: string; text: string }> = [];

  const variantSource = findSourcePlaylist(files, rendition);
  const audioSource = findAudioPlaylist(files);
  let hasAudio = false;

  if (audioSource) {
    const audioText = await readAssetText(videoId, audioSource);
    if (audioText) {
      const outputPath = 'offline-audio.m3u8';
      generated.push({
        path: outputPath,
        text: rewritePlaylistForOfflineRelative(audioText, audioSource, outputPath),
      });
      hasAudio = true;
    }
  }

  if (variantSource) {
    const variantText = await readAssetText(videoId, variantSource);
    if (variantText) {
      const outputPath = `${rendition}/offline-playlist.m3u8`;
      generated.push({
        path: outputPath,
        text: rewritePlaylistForOfflineRelative(variantText, variantSource, outputPath),
      });
    }
  }

  generated.push({
    path: 'offline-master.m3u8',
    text: buildOfflineMasterPlaylist(rendition, hasAudio),
  });

  return generated;
}

export function isDownloadActive(videoId: string, userId: string): boolean {
  const entry = activeDownloads.get(videoId);
  return Boolean(entry && entry.userId === userId);
}

export async function getDownloadRecord(
  videoId: string,
  userId: string,
): Promise<StoredDownload | null> {
  const record = await readStoredDownload(videoId);
  if (!record || record.userId !== userId) return null;
  return record;
}

export async function listDownloadRecords(userId: string): Promise<StoredDownload[]> {
  const all = await listStoredDownloads();
  return all.filter((d) => d.userId === userId);
}

export async function getOfflinePlaybackUri(
  videoId: string,
  userId: string,
): Promise<string | null> {
  const record = await readStoredDownload(videoId);
  if (record?.status !== 'completed') return null;
  if (record.userId !== userId) return null;
  if (!isLicensePlaybackAllowed(record.license)) return null;
  const ready = await assetExists(videoId, 'offline-master.m3u8');
  if (!ready) return null;
  // Prefer loopback HTTP — file:// HLS is rejected by iOS AVPlayer / expo-video.
  try {
    const origin = await ensureOfflinePlaybackServer();
    return buildOfflinePlaybackHttpUrl(origin, videoId);
  } catch {
    return null;
  }
}

export async function startOfflineDownload({
  accessToken,
  userId,
  videoId,
  rendition,
}: {
  accessToken: string;
  userId: string;
  videoId: string;
  rendition: OfflineRendition;
}): Promise<void> {
  const existingActive = activeDownloads.get(videoId);
  if (existingActive) {
    if (existingActive.userId === userId) {
      return existingActive.promise;
    }
    existingActive.controller.abort();
    await existingActive.promise.catch(() => undefined);
  }

  // Another caller may have started while we waited for a foreign task.
  const raced = activeDownloads.get(videoId);
  if (raced) {
    if (raced.userId === userId) {
      return raced.promise;
    }
    raced.controller.abort();
    await raced.promise.catch(() => undefined);
  }

  const controller = new AbortController();
  let entry!: ActiveDownload;

  const promise = (async () => {
    try {
      const existingRecord = await readStoredDownload(videoId);
      const sameAccount = existingRecord?.userId === userId;
      let isResume = Boolean(
        sameAccount &&
          existingRecord &&
          existingRecord.rendition === rendition &&
          (existingRecord.status === 'paused' || existingRecord.status === 'failed') &&
          existingRecord.filesCompleted > 0,
      );

      const device = await ensureOfflineDevice(accessToken, userId);
      if (device.userId !== userId) {
        throw new Error('Offline device is not bound to the current account');
      }

      if (!isResume) {
        const initial: StoredDownload = {
          videoId,
          videoTitle: sameAccount ? (existingRecord?.videoTitle ?? '') : '',
          userId,
          rendition,
          status: 'downloading',
          license:
            sameAccount && existingRecord?.license
              ? existingRecord.license
              : {
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
          manifestHash: sameAccount ? (existingRecord?.manifestHash ?? '') : '',
          manifestVersion: sameAccount ? (existingRecord?.manifestVersion ?? 1) : 1,
          bytesDownloaded: 0,
          totalBytes: 0,
          filesCompleted: 0,
          filesTotal: 0,
          errorMessage: null,
          createdAt: sameAccount ? (existingRecord?.createdAt ?? nowIso()) : nowIso(),
          updatedAt: nowIso(),
          completedAt: null,
        };
        await writeStoredDownload(initial);
        emitProgress(videoId, initial);
      } else {
        await patchDownload(videoId, {
          status: 'downloading',
          errorMessage: null,
          userId,
          downloadToken: '',
        });
      }

      const data = await authorizeOfflineDownload(accessToken, videoId, {
        rendition,
        deviceId: device.deviceId,
        deviceToken: device.deviceToken,
      });

      if (
        isResume &&
        existingRecord &&
        (existingRecord.manifestHash !== data.license.manifestHash ||
          existingRecord.manifestVersion !== data.license.manifestVersion)
      ) {
        isResume = false;
        await deleteOfflineVideo(videoId);
      }

      if (!isResume) {
        await deleteOfflineVideo(videoId);
      }

      const downloadableFiles = data.manifest.files.filter(
        (f: OfflineManifestFile) => !isGeneratedManifestPath(f.path),
      );
      const totalBytes =
        data.estimatedBytes ?? data.manifest.totalBytes ?? existingRecord?.totalBytes ?? 0;

      await patchDownload(videoId, {
        videoTitle: data.video?.title ?? existingRecord?.videoTitle ?? videoId,
        userId,
        license: data.license,
        downloadToken: '',
        manifestHash: data.license.manifestHash,
        manifestVersion: data.license.manifestVersion,
        totalBytes,
        filesTotal: downloadableFiles.length,
        filesCompleted: isResume ? (existingRecord?.filesCompleted ?? 0) : 0,
        bytesDownloaded: isResume ? (existingRecord?.bytesDownloaded ?? 0) : 0,
        status: 'downloading',
        errorMessage: null,
      });

      let bytesDownloaded = isResume ? (existingRecord?.bytesDownloaded ?? 0) : 0;
      let filesCompleted = isResume ? (existingRecord?.filesCompleted ?? 0) : 0;

      for (const file of downloadableFiles) {
        if (controller.signal.aborted) throw new Error('Download paused');
        if (isResume && (await assetExists(videoId, file.path))) {
          continue;
        }
        const remoteUrl = buildOfflineAssetUrl(videoId, file.path, data.downloadToken);
        const size = await downloadRemoteAsset(remoteUrl, videoId, file.path);
        bytesDownloaded += size;
        filesCompleted += 1;
        await patchDownload(videoId, {
          bytesDownloaded,
          filesCompleted,
        });
      }

      await patchDownload(videoId, {
        bytesDownloaded,
        filesCompleted: downloadableFiles.length,
      });

      const generated = await buildGeneratedManifests(videoId, rendition, data.manifest.files);
      const renditionPlaylistPath = `${rendition}/offline-playlist.m3u8`;
      if (!generated.some((item) => item.path === renditionPlaylistPath)) {
        throw new Error('Offline rendition playlist could not be built');
      }
      for (const item of generated) {
        if (controller.signal.aborted) throw new Error('Download paused');
        await writeAssetText(videoId, item.path, item.text);
        bytesDownloaded += item.text.length;
      }

      if (controller.signal.aborted) throw new Error('Download paused');

      await patchDownload(videoId, {
        status: 'completed',
        bytesDownloaded,
        filesCompleted: downloadableFiles.length,
        completedAt: nowIso(),
        errorMessage: null,
        downloadToken: '',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Download failed';
      const aborted =
        controller.signal.aborted ||
        (err instanceof Error && (err.name === 'AbortError' || /paused|abort/i.test(err.message)));
      if (aborted) {
        await patchDownload(videoId, {
          status: 'paused',
          errorMessage: null,
          downloadToken: '',
        }).catch(() => undefined);
      } else {
        await patchDownload(videoId, {
          status: 'failed',
          errorMessage: message,
          downloadToken: '',
        }).catch(() => undefined);
      }
      throw err;
    } finally {
      if (activeDownloads.get(videoId) === entry) {
        activeDownloads.delete(videoId);
      }
    }
  })();

  entry = { userId, controller, promise };
  activeDownloads.set(videoId, entry);
  return promise;
}

export async function pauseOfflineDownload(videoId: string, userId: string): Promise<void> {
  const entry = activeDownloads.get(videoId);
  if (entry) {
    if (entry.userId !== userId) return;
    entry.controller.abort();
    await entry.promise.catch(() => undefined);
  }
  const record = await readStoredDownload(videoId);
  if (record && record.userId === userId && record.status === 'downloading') {
    await patchDownload(videoId, { status: 'paused', downloadToken: '' });
  }
}

export async function removeOfflineDownload(
  accessToken: string,
  videoId: string,
  userId: string,
): Promise<void> {
  const record = await readStoredDownload(videoId);
  if (!record || record.userId !== userId) {
    // Abort only this account's in-flight task; never touch another account's files.
    await pauseOfflineDownload(videoId, userId);
    return;
  }
  await pauseOfflineDownload(videoId, userId);
  await revokeOfflineDownload(accessToken, videoId).catch(() => undefined);
  await deleteOfflineVideo(videoId);
  await deleteStoredDownload(videoId);
}

export async function getPlayableOfflineSummary(
  videoId: string,
  userId: string,
): Promise<{
  record: StoredDownload;
  playlistUri: string;
  licenseDue: boolean;
} | null> {
  const record = await getDownloadRecord(videoId, userId);
  if (record?.status !== 'completed') return null;
  if (!isLicensePlaybackAllowed(record.license)) return null;
  const playlistUri = await getOfflinePlaybackUri(videoId, userId);
  if (!playlistUri) return null;
  return {
    record,
    playlistUri,
    licenseDue: isLicenseRevalidationDue(record.license),
  };
}

export async function hasRegisteredOfflineDevice(userId?: string): Promise<boolean> {
  const device = await readStoredDevice();
  if (!device) return false;
  if (userId && device.userId !== userId) return false;
  return true;
}

export { deviceAuthHeaders, ensureOfflineDevice, readStoredDevice };
