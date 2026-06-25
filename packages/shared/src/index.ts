export {
  placementTimestampMs,
  compareVideosNewestFirst,
} from './homepagePlacementSort.js'

export {
  canonicalWatchToken,
  isValidVideoSlug,
  sanitizeVideoSlug,
  transliterateToAscii,
} from './videoSlug.js'

export type {
  CmsBlock,
  CmsCalloutBlock,
  CmsCalloutVariant,
  CmsDividerBlock,
  CmsImageBlock,
  CmsMedia,
  CmsPage,
  CmsPageInput,
  CmsPageRevision,
  CmsPageStatus,
  CmsRichTextBlock,
  CmsRichTextDocument,
  CmsTableBlock,
} from './cms.js'

export {
  CMS_FOOTER_PAGE_ID,
  CMS_FOOTER_SLUG,
  CMS_PERSONAL_DATA_PAGE_ID,
  isCmsSystemPageId,
  isCmsSystemSlug,
} from './cmsSystemPages.js'

export interface User {
  id: string
  email: string
  createdAt: string
}

export interface Subscription {
  id: number
  userId: string
  planType: 'free' | 'premium'
  status: 'active' | 'cancelled' | 'expired'
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Video {
  id: string
  title: string
  fullDuration: number
  previewDuration: number
  createdAt: string
}

export interface Chapter {
  title: string
  startTime: number
  endTime: number
  accessible: boolean
}

export interface VideoAccessResponse {
  userId: string
  videoId: string
  hasAccess: boolean
  subscription: {
    planType: string
    status: string
    expiresAt: string | null
  }
  video: {
    title: string
    fullDuration: number
    previewDuration: number
    playlistUrl: string
  }
  chapters: Chapter[]
}

/** HLS rendition keys supported for offline download. */
export type OfflineRendition = '480p' | '720p' | '1080p'

export function isOfflineRendition(value: unknown): value is OfflineRendition {
  return value === '480p' || value === '720p' || value === '1080p'
}

export interface OfflineDeviceRegistration {
  deviceId: string
  deviceToken: string
  deviceName: string
  registeredAt: string
}

export interface OfflineDeviceSummary {
  deviceId: string
  deviceName: string
  hasPublicKey: boolean
  registeredAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  active: boolean
}

export interface OfflineManifestFile {
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

export interface OfflineLicense {
  licenseId: string
  deviceId: string
  videoId: string
  rendition: OfflineRendition
  expiresAt: string
  manifestHash: string
  manifestVersion: number
  playbackState: 'allowed' | 'expired' | 'revoked' | string
  nextValidationDueAt: string
  signature: string
}

export interface OfflineAuthorizeResponse {
  license: OfflineLicense
  manifest: OfflineManifest
  downloadToken: string
  estimatedBytes: number
  video: {
    id: string
    title: string
    fullDuration: number
  }
}

export interface OfflineDownloadSummary {
  licenseId: string
  videoId: string
  videoTitle: string | null
  deviceId: string
  rendition: OfflineRendition
  status: string
  issuedAt: string
  expiresAt: string
  lastRenewedAt: string | null
  manifestHash: string
  manifestVersion: number
}