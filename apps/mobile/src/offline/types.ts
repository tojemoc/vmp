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
}

export interface StoredDownload {
  videoId: string;
  videoTitle: string;
  rendition: OfflineRendition;
  status: DownloadStatus;
  license: OfflineLicense;
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
  status: DownloadStatus;
  bytesDownloaded: number;
  totalBytes: number;
  filesCompleted: number;
  filesTotal: number;
  errorMessage: string | null;
}
