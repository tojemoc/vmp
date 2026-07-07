import type { R2Bucket, R2HTTPMetadata, R2Range } from '@cloudflare/workers-types'
import { StorageNotFoundError } from './errors.js'
import type {
  GetObjectOptions,
  HeadObjectResult,
  ListedObject,
  ObjectStorageProvider,
  PutObjectOptions,
  StorageObjectResponse,
} from './types.js'

function normalizeKey(key: string): string {
  return key.replace(/^\/+/, '')
}

function isOffsetLengthRange(
  range: R2Range,
): range is { offset: number; length: number } {
  return typeof (range as { offset?: number }).offset === 'number'
    && typeof (range as { length?: number }).length === 'number'
}

function parseRangeHeader(range: string): R2Range | undefined {
  const match = /^bytes=(\d+)-(\d*)$/i.exec(range.trim())
  if (!match) return undefined
  const offset = Number.parseInt(match[1] ?? '0', 10)
  const endRaw = match[2]
  if (!Number.isFinite(offset)) return undefined
  if (!endRaw) {
    return { offset }
  }
  const end = Number.parseInt(endRaw, 10)
  if (!Number.isFinite(end) || end < offset) return undefined
  return { offset, length: end - offset + 1 }
}

function buildResponseHeaders(object: NonNullable<Awaited<ReturnType<R2Bucket['get']>>>): Headers {
  const headers = new Headers()
  if (object.httpMetadata?.contentType) {
    headers.set('Content-Type', object.httpMetadata.contentType)
  }
  if (object.httpMetadata?.cacheControl) {
    headers.set('Cache-Control', object.httpMetadata.cacheControl)
  }
  if (object.etag) headers.set('ETag', object.etag)
  if (object.uploaded) headers.set('Last-Modified', object.uploaded.toUTCString())
  return headers
}

function toHeadResult(key: string, object: NonNullable<Awaited<ReturnType<R2Bucket['head']>>>): HeadObjectResult {
  const result: HeadObjectResult = {
    key,
    size: object.size,
    etag: object.etag,
    lastModified: object.uploaded,
  }
  if (object.httpMetadata?.contentType) {
    result.contentType = object.httpMetadata.contentType
  }
  return result
}

export class R2BindingProvider implements ObjectStorageProvider {
  constructor(private readonly bucket: R2Bucket) {}

  async getObject(key: string, opts?: GetObjectOptions): Promise<StorageObjectResponse> {
    const normalized = normalizeKey(key)
    const parsedRange = opts?.range ? parseRangeHeader(opts.range) : undefined
    const object = parsedRange
      ? await this.bucket.get(normalized, { range: parsedRange })
      : await this.bucket.get(normalized)
    if (!object) throw new StorageNotFoundError(normalized)

    const headers = buildResponseHeaders(object)
    const body = object.body as unknown as ReadableStream<Uint8Array> | null
    if (object.range && isOffsetLengthRange(object.range)) {
      const start = object.range.offset
      const end = object.range.offset + object.range.length - 1
      headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`)
      headers.set('Content-Length', String(object.range.length))
      headers.set('Accept-Ranges', 'bytes')
      return { status: 206, headers, body }
    }

    if (object.size !== undefined) {
      headers.set('Content-Length', String(object.size))
    }
    headers.set('Accept-Ranges', 'bytes')
    return { status: 200, headers, body }
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    const normalized = normalizeKey(key)
    const object = await this.bucket.head(normalized)
    if (!object) return null
    return toHeadResult(normalized, object)
  }

  async putObject(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts?: PutObjectOptions,
  ): Promise<void> {
    const normalized = normalizeKey(key)
    const putBody = body as Parameters<R2Bucket['put']>[1]
    const httpMetadata: R2HTTPMetadata = {}
    if (opts?.contentType) httpMetadata.contentType = opts.contentType
    if (opts?.cacheControl) httpMetadata.cacheControl = opts.cacheControl
    if (Object.keys(httpMetadata).length > 0) {
      await this.bucket.put(normalized, putBody, { httpMetadata })
    } else {
      await this.bucket.put(normalized, putBody)
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.bucket.delete(normalizeKey(key))
  }

  async listObjects(prefix: string): Promise<ListedObject[]> {
    const normalized = prefix.replace(/^\/+/, '')
    const out: ListedObject[] = []
    let cursor: string | undefined
    do {
      const listOptions: { prefix: string; limit: number; cursor?: string } = {
        prefix: normalized,
        limit: 1000,
      }
      if (cursor) listOptions.cursor = cursor
      const listed = await this.bucket.list(listOptions)
      for (const obj of listed.objects) {
        const entry: ListedObject = { key: obj.key, size: obj.size }
        if (obj.uploaded) entry.lastModified = obj.uploaded
        out.push(entry)
      }
      cursor = listed.truncated ? listed.cursor : undefined
    } while (cursor)
    return out
  }
}
