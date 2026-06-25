import { IDB_CHUNK_BYTES, OFFLINE_OPFS_ROOT } from './constants'

const IDB_BLOB_DB = 'vmp-offline-blobs'
const IDB_BLOB_STORE = 'chunks'

let opfsSupported: boolean | null = null

export function isOpfsSupported(): boolean {
  if (import.meta.server) return false
  if (opfsSupported !== null) return opfsSupported
  opfsSupported = typeof navigator.storage?.getDirectory === 'function'
  return opfsSupported
}

function blobKey(videoId: string, relativePath: string): string {
  return `${videoId}/${relativePath}`
}

async function getVideoDirectory(videoId: string, create = false): Promise<FileSystemDirectoryHandle | null> {
  if (!isOpfsSupported()) return null
  const root = await navigator.storage.getDirectory()
  let offlineRoot: FileSystemDirectoryHandle
  try {
    offlineRoot = await root.getDirectoryHandle(OFFLINE_OPFS_ROOT, { create })
  } catch {
    return null
  }
  try {
    return await offlineRoot.getDirectoryHandle(videoId, { create })
  } catch {
    return null
  }
}

async function ensureParentDir(
  videoDir: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = relativePath.split('/').filter(Boolean)
  const fileName = parts.pop()
  if (!fileName) throw new Error('Invalid path')
  let current = videoDir
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true })
  }
  return current
}

function openBlobIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_BLOB_DB, 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_BLOB_STORE)) {
        db.createObjectStore(IDB_BLOB_STORE)
      }
    }
  })
}

async function writeIdbChunks(key: string, data: Uint8Array): Promise<void> {
  const db = await openBlobIdb()
  const chunkCount = Math.ceil(data.byteLength / IDB_CHUNK_BYTES) || 1
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_BLOB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    const store = tx.objectStore(IDB_BLOB_STORE)
    store.put({ byteLength: data.byteLength, chunkCount }, `${key}:meta`)
    for (let i = 0; i < chunkCount; i++) {
      const start = i * IDB_CHUNK_BYTES
      const end = Math.min(start + IDB_CHUNK_BYTES, data.byteLength)
      store.put(data.subarray(start, end), `${key}:chunk:${i}`)
    }
  })
}

async function readIdbChunks(key: string): Promise<Uint8Array | null> {
  const db = await openBlobIdb()
  const meta = await new Promise<{ byteLength: number, chunkCount: number } | undefined>((resolve, reject) => {
    const tx = db.transaction(IDB_BLOB_STORE, 'readonly')
    tx.onerror = () => reject(tx.error)
    const req = tx.objectStore(IDB_BLOB_STORE).get(`${key}:meta`)
    req.onsuccess = () => resolve(req.result as { byteLength: number, chunkCount: number } | undefined)
    req.onerror = () => reject(req.error)
  })
  if (!meta) return null

  const parts: Uint8Array[] = []
  for (let i = 0; i < meta.chunkCount; i++) {
    const chunk = await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_BLOB_STORE, 'readonly')
      tx.onerror = () => reject(tx.error)
      const req = tx.objectStore(IDB_BLOB_STORE).get(`${key}:chunk:${i}`)
      req.onsuccess = () => resolve(req.result as Uint8Array | undefined)
      req.onerror = () => reject(req.error)
    })
    if (!chunk) return null
    parts.push(chunk)
  }
  const merged = new Uint8Array(meta.byteLength)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.byteLength
  }
  return merged
}

async function deleteIdbChunks(key: string): Promise<void> {
  const db = await openBlobIdb()
  const meta = await new Promise<{ chunkCount: number } | undefined>((resolve, reject) => {
    const tx = db.transaction(IDB_BLOB_STORE, 'readonly')
    tx.onerror = () => reject(tx.error)
    const req = tx.objectStore(IDB_BLOB_STORE).get(`${key}:meta`)
    req.onsuccess = () => resolve(req.result as { chunkCount: number } | undefined)
    req.onerror = () => reject(req.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_BLOB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    const store = tx.objectStore(IDB_BLOB_STORE)
    store.delete(`${key}:meta`)
    if (meta) {
      for (let i = 0; i < meta.chunkCount; i++) {
        store.delete(`${key}:chunk:${i}`)
      }
    }
  })
}

export async function writeOfflineAsset(
  videoId: string,
  relativePath: string,
  data: Uint8Array | ArrayBuffer,
): Promise<void> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const videoDir = await getVideoDirectory(videoId, true)
  if (videoDir) {
    const parent = await ensureParentDir(videoDir, relativePath)
    const fileName = relativePath.split('/').filter(Boolean).pop()!
    const handle = await parent.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    await writable.write(new Uint8Array(bytes))
    await writable.close()
    return
  }
  await writeIdbChunks(blobKey(videoId, relativePath), bytes)
}

export async function readOfflineAsset(
  videoId: string,
  relativePath: string,
): Promise<Uint8Array | null> {
  const videoDir = await getVideoDirectory(videoId, false)
  if (videoDir) {
    try {
      const parts = relativePath.split('/').filter(Boolean)
      const fileName = parts.pop()!
      let current: FileSystemDirectoryHandle = videoDir
      for (const part of parts) {
        current = await current.getDirectoryHandle(part)
      }
      const handle = await current.getFileHandle(fileName)
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch {
      return null
    }
  }
  return readIdbChunks(blobKey(videoId, relativePath))
}

export async function deleteOfflineVideo(videoId: string): Promise<void> {
  if (isOpfsSupported()) {
    try {
      const root = await navigator.storage.getDirectory()
      const offlineRoot = await root.getDirectoryHandle(OFFLINE_OPFS_ROOT)
      await offlineRoot.removeEntry(videoId, { recursive: true })
    } catch {
      // directory may not exist
    }
  }

  const db = await openBlobIdb()
  const keys = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(IDB_BLOB_STORE, 'readonly')
    tx.onerror = () => reject(tx.error)
    const req = tx.objectStore(IDB_BLOB_STORE).getAllKeys()
    req.onsuccess = () => {
      const prefix = `${videoId}/`
      const all = (req.result as string[]) ?? []
      resolve(all.filter(k => typeof k === 'string' && k.startsWith(prefix)))
    }
    req.onerror = () => reject(req.error)
  })

  const metaKeys = [...new Set(keys.map(k => String(k).split(':')[0]))]
  for (const key of metaKeys) {
    if (key) await deleteIdbChunks(key)
  }
}

export async function estimateOfflineBytes(videoId: string): Promise<number> {
  if (isOpfsSupported()) {
    const videoDir = await getVideoDirectory(videoId, false)
    if (!videoDir) return 0
    let total = 0
    const walk = async (dir: FileSystemDirectoryHandle) => {
      for await (const handle of dir.values()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile()
          total += file.size
        } else {
          await walk(handle)
        }
      }
    }
    try {
      await walk(videoDir)
    } catch {
      return 0
    }
    return total
  }

  const db = await openBlobIdb()
  const metas = await new Promise<Array<{ byteLength: number }>>((resolve, reject) => {
    const tx = db.transaction(IDB_BLOB_STORE, 'readonly')
    tx.onerror = () => reject(tx.error)
    const req = tx.objectStore(IDB_BLOB_STORE).getAll()
    req.onsuccess = () => resolve((req.result as Array<{ byteLength: number }>) ?? [])
    req.onerror = () => reject(req.error)
  })
  return metas.reduce((sum, m) => sum + (m.byteLength ?? 0), 0)
}

export function contentTypeForPath(path: string): string {
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (path.endsWith('.m4s')) return 'video/iso.segment'
  if (path.endsWith('.mp4')) return 'video/mp4'
  if (path.endsWith('.vtt')) return 'text/vtt'
  return 'application/octet-stream'
}
