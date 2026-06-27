/** URL prefix served by `sw-offline-media.js` from OPFS. */
export const OFFLINE_MEDIA_URL_PREFIX = '/__vmp/offline-media/'

/** Root directory inside OPFS for downloaded assets. */
export const OFFLINE_OPFS_ROOT = 'vmp-offline'

export const OFFLINE_IDB_NAME = 'vmp-offline'
export const OFFLINE_IDB_VERSION = 1

export const OFFLINE_STORE_DEVICE = 'device'
export const OFFLINE_STORE_DOWNLOADS = 'downloads'
export const OFFLINE_STORE_QUEUE = 'queue'

export const DEVICE_TOKEN_HEADER = 'x-vmp-device-token'

/** IndexedDB chunked blob fallback when OPFS is unavailable. */
export const IDB_CHUNK_BYTES = 4 * 1024 * 1024
