import type { GetObjectResult, ObjectStorageProvider } from '@vmp/storage/worker'
import { wrapR2Bucket } from '@vmp/storage/worker'
import type { R2Bucket } from '@cloudflare/workers-types'

const storageByBucket = new WeakMap<R2Bucket, ObjectStorageProvider>()

export type StorageEnv = {
  BUCKET?: R2Bucket
  STORAGE?: ObjectStorageProvider
}

/** Composition-root accessor: prefer injected STORAGE, else wrap the R2 binding. */
export function getObjectStorage(env: StorageEnv): ObjectStorageProvider | undefined {
  if (env.STORAGE) return env.STORAGE
  if (!env.BUCKET) return undefined
  let cached = storageByBucket.get(env.BUCKET)
  if (!cached) {
    cached = wrapR2Bucket(env.BUCKET)
    storageByBucket.set(env.BUCKET, cached)
  }
  return cached
}

export function hasObjectStorage(env: StorageEnv): boolean {
  return Boolean(getObjectStorage(env))
}

/** Parse `Range: bytes=start-end` into provider byte-range options. */
export function parseHttpRangeHeader(rangeHeader: string | null): { offset: number; length?: number } | undefined {
  if (!rangeHeader) return undefined
  const match = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) return undefined
  const offset = Number.parseInt(match[1]!, 10)
  if (!Number.isFinite(offset) || offset < 0) return undefined
  if (!match[2]) return { offset }
  const end = Number.parseInt(match[2], 10)
  if (!Number.isFinite(end) || end < offset) return undefined
  return { offset, length: end - offset + 1 }
}

/** Build an HTTP Response from a storage getObject result (streaming body, Range metadata). */
export function storageGetResultToResponse(result: GetObjectResult): Response {
  const headers = new Headers()
  if (result.contentType) headers.set('Content-Type', result.contentType)
  const isPartial = Boolean(result.range)
  if (isPartial && result.range) {
    const { offset, length } = result.range
    const total = result.size ?? offset + length
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${total}`)
    headers.set('Content-Length', String(length))
  } else if (result.size != null) {
    headers.set('Content-Length', String(result.size))
  }
  return new Response(result.body as ReadableStream, {
    status: isPartial ? 206 : 200,
    headers,
  })
}
