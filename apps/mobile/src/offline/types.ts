import type { OfflineLicense, OfflineRendition } from '@vmp/shared';

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'paused'
  | 'failed'
  | 'license_expired';

export interface StoredDevice {
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  registeredAt: string;
  /** Account that registered this offline device — never reuse across users. */
  userId: string;
}

export interface StoredDownload {
  videoId: string;
  videoTitle: string;
  /** Account that created this download — playback gated on matching session. */
  userId: string;
  rendition: OfflineRendition;
  status: DownloadStatus;
  license: OfflineLicense;
  /**
   * Intentionally not persisted with a live value. Authorize returns a fresh
   * download token for each start/resume; keep the field empty in the index.
   */
  downloadToken: string;
  manifestHash: string;
  manifestVersion: number;
  bytesDownloaded: number;
  totalBytes: number;
  filesCompleted: number;
  filesTotal: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface DownloadProgress {
  videoId: string;
  userId: string;
  status: DownloadStatus;
  bytesDownloaded: number;
  totalBytes: number;
  filesCompleted: number;
  filesTotal: number;
  errorMessage: string | null;
}
