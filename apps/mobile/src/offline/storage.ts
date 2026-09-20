import * as FileSystem from 'expo-file-system/legacy';
import { DOWNLOADS_INDEX_FILE, OFFLINE_ROOT_DIR } from './constants';
import type { StoredDownload } from './types';

function requireDocumentDirectory(): string {
  const root = FileSystem.documentDirectory;
  if (!root) {
    throw new Error('FileSystem.documentDirectory is unavailable on this platform');
  }
  return root;
}

export function offlineRootUri(): string {
  return `${requireDocumentDirectory()}${OFFLINE_ROOT_DIR}/`;
}

export function videoRootUri(videoId: string): string {
  return `${offlineRootUri()}${encodeURIComponent(videoId)}/`;
}

export function assetUri(videoId: string, relativePath: string): string {
  const encoded = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${videoRootUri(videoId)}${encoded}`;
}

export function masterPlaylistUri(videoId: string): string {
  return assetUri(videoId, 'offline-master.m3u8');
}

async function ensureDir(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  }
}

export async function ensureOfflineRoot(): Promise<void> {
  await ensureDir(offlineRootUri());
}

function downloadsIndexUri(): string {
  return `${offlineRootUri()}${DOWNLOADS_INDEX_FILE}`;
}

export async function listStoredDownloads(): Promise<StoredDownload[]> {
  await ensureOfflineRoot();
  const uri = downloadsIndexUri();
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) return [];
  try {
    const raw = await FileSystem.readAsStringAsync(uri);
    const parsed = JSON.parse(raw) as StoredDownload[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeDownloadsIndex(downloads: StoredDownload[]): Promise<void> {
  await ensureOfflineRoot();
  await FileSystem.writeAsStringAsync(downloadsIndexUri(), JSON.stringify(downloads));
}

export async function readStoredDownload(videoId: string): Promise<StoredDownload | null> {
  const all = await listStoredDownloads();
  return all.find((d) => d.videoId === videoId) ?? null;
}

export async function writeStoredDownload(record: StoredDownload): Promise<void> {
  const all = await listStoredDownloads();
  const idx = all.findIndex((d) => d.videoId === record.videoId);
  if (idx >= 0) all[idx] = record;
  else all.push(record);
  await writeDownloadsIndex(all);
}

export async function deleteStoredDownload(videoId: string): Promise<void> {
  const all = await listStoredDownloads();
  await writeDownloadsIndex(all.filter((d) => d.videoId !== videoId));
}

export async function ensureVideoDir(videoId: string): Promise<void> {
  await ensureDir(videoRootUri(videoId));
}

export async function assetExists(videoId: string, relativePath: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(assetUri(videoId, relativePath));
  return info.exists && !info.isDirectory;
}

export async function readAssetText(videoId: string, relativePath: string): Promise<string | null> {
  const uri = assetUri(videoId, relativePath);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory) return null;
  return FileSystem.readAsStringAsync(uri);
}

export async function writeAssetText(
  videoId: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  await ensureVideoDir(videoId);
  const uri = assetUri(videoId, relativePath);
  const parent = uri.slice(0, uri.lastIndexOf('/') + 1);
  await ensureDir(parent);
  await FileSystem.writeAsStringAsync(uri, contents);
}

export async function downloadRemoteAsset(
  remoteUrl: string,
  videoId: string,
  relativePath: string,
): Promise<number> {
  await ensureVideoDir(videoId);
  const uri = assetUri(videoId, relativePath);
  const parent = uri.slice(0, uri.lastIndexOf('/') + 1);
  await ensureDir(parent);
  const result = await FileSystem.downloadAsync(remoteUrl, uri);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Failed to download ${relativePath} (HTTP ${result.status})`);
  }
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && !info.isDirectory && typeof info.size === 'number' ? info.size : 0;
}

export async function deleteOfflineVideo(videoId: string): Promise<void> {
  const uri = videoRootUri(videoId);
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}
