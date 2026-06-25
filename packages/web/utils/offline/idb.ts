import {
  OFFLINE_IDB_NAME,
  OFFLINE_IDB_VERSION,
  OFFLINE_STORE_DEVICE,
  OFFLINE_STORE_DOWNLOADS,
  OFFLINE_STORE_QUEUE,
} from './constants'
import type { StoredDevice, StoredDownload } from './types'

function openOfflineIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_IDB_NAME, OFFLINE_IDB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(OFFLINE_STORE_DEVICE)) {
        db.createObjectStore(OFFLINE_STORE_DEVICE)
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_DOWNLOADS)) {
        db.createObjectStore(OFFLINE_STORE_DOWNLOADS, { keyPath: 'videoId' })
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_QUEUE)) {
        db.createObjectStore(OFFLINE_STORE_QUEUE, { keyPath: 'videoId' })
      }
    }
  })
}

export async function readStoredDevice(): Promise<StoredDevice | null> {
  if (import.meta.server) return null
  try {
    const db = await openOfflineIdb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE_DEVICE, 'readonly')
      tx.onerror = () => reject(tx.error)
      const req = tx.objectStore(OFFLINE_STORE_DEVICE).get('current')
      req.onsuccess = () => resolve((req.result as StoredDevice | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function writeStoredDevice(device: StoredDevice): Promise<void> {
  const db = await openOfflineIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_DEVICE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(OFFLINE_STORE_DEVICE).put(device, 'current')
  })
}

export async function clearStoredDevice(): Promise<void> {
  const db = await openOfflineIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_DEVICE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(OFFLINE_STORE_DEVICE).delete('current')
  })
}

export async function listStoredDownloads(): Promise<StoredDownload[]> {
  if (import.meta.server) return []
  try {
    const db = await openOfflineIdb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE_DOWNLOADS, 'readonly')
      tx.onerror = () => reject(tx.error)
      const req = tx.objectStore(OFFLINE_STORE_DOWNLOADS).getAll()
      req.onsuccess = () => resolve((req.result as StoredDownload[]) ?? [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function readStoredDownload(videoId: string): Promise<StoredDownload | null> {
  if (import.meta.server) return null
  try {
    const db = await openOfflineIdb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE_DOWNLOADS, 'readonly')
      tx.onerror = () => reject(tx.error)
      const req = tx.objectStore(OFFLINE_STORE_DOWNLOADS).get(videoId)
      req.onsuccess = () => resolve((req.result as StoredDownload | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function writeStoredDownload(record: StoredDownload): Promise<void> {
  const db = await openOfflineIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_DOWNLOADS, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(OFFLINE_STORE_DOWNLOADS).put(record)
  })
}

export async function deleteStoredDownload(videoId: string): Promise<void> {
  const db = await openOfflineIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_DOWNLOADS, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(OFFLINE_STORE_DOWNLOADS).delete(videoId)
  })
}

export async function enqueueDownload(videoId: string): Promise<void> {
  const db = await openOfflineIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_QUEUE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(OFFLINE_STORE_QUEUE).put({ videoId, queuedAt: new Date().toISOString() })
  })
}

export async function dequeueDownload(videoId: string): Promise<void> {
  const db = await openOfflineIdb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_QUEUE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(OFFLINE_STORE_QUEUE).delete(videoId)
  })
}

export async function listQueuedDownloads(): Promise<string[]> {
  if (import.meta.server) return []
  try {
    const db = await openOfflineIdb()
    const rows = await new Promise<Array<{ videoId: string, queuedAt: string }>>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE_QUEUE, 'readonly')
      tx.onerror = () => reject(tx.error)
      const req = tx.objectStore(OFFLINE_STORE_QUEUE).getAll()
      req.onsuccess = () => resolve((req.result as Array<{ videoId: string, queuedAt: string }>) ?? [])
      req.onerror = () => reject(req.error)
    })
    return rows
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
      .map(r => r.videoId)
  } catch {
    return []
  }
}
