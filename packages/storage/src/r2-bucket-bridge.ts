import type { R2Bucket, R2ListOptions, R2Objects } from '@cloudflare/workers-types'
import type { ObjectStorageProvider } from './types.js'

/**
 * Adapts ObjectStorageProvider to the Cloudflare R2Bucket shape expected by legacy call sites
 * (api-node worker bridge). Prefer ObjectStorageProvider in new code.
 */
export class ObjectStorageR2BucketBridge {
  constructor(private readonly storage: ObjectStorageProvider) {}

  async head(key: string) {
    const meta = await this.storage.headObject(key)
    if (!meta) return null
    return {
      key: meta.key,
      size: meta.size,
      etag: meta.etag ?? '',
      uploaded: meta.lastModified ?? new Date(),
      httpMetadata: { contentType: meta.contentType },
      customMetadata: {},
      checksums: {},
      writeHttpMetadata(headers: Headers) {
        if (meta.contentType) headers.set('Content-Type', meta.contentType)
      },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
      json: async () => ({}),
      blob: async () => new Blob(),
    }
  }

  async get(key: string, options?: { range?: { offset: number; length?: number } }) {
    const result = await this.storage.getObject(key, options?.range ? { range: options.range } : undefined)
    if (!result) return null
    const stream = result.body instanceof ReadableStream
      ? result.body
      : new Response(result.body as BlobPart).body!
    return {
      key,
      size: result.size ?? 0,
      etag: '',
      uploaded: new Date(),
      httpMetadata: { contentType: result.contentType },
      customMetadata: {},
      body: stream,
      range: result.range,
      writeHttpMetadata(headers: Headers) {
        if (result.contentType) headers.set('Content-Type', result.contentType)
      },
      arrayBuffer: async () => new Response(stream).arrayBuffer(),
      text: async () => new Response(stream).text(),
      json: async () => JSON.parse(await new Response(stream).text()) as unknown,
      blob: async () => new Response(stream).blob(),
    }
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ) {
    await this.storage.putObject(key, value as ReadableStream, {
      contentType: options?.httpMetadata?.contentType,
      metadata: options?.customMetadata,
    })
    return this.head(key)
  }

  async delete(keys: string | string[]) {
    if (this.storage.deleteObjects) {
      const list = Array.isArray(keys) ? keys : [keys]
      await this.storage.deleteObjects(list)
      return
    }
    const list = Array.isArray(keys) ? keys : [keys]
    for (const key of list) await this.storage.deleteObject(key)
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    if (!this.storage.listObjectsPage) {
      const objects = await this.storage.listObjects(options?.prefix ?? '')
      return {
        objects: objects.map((o) => ({
          key: o.key,
          size: o.size,
          etag: o.etag ?? '',
          uploaded: o.lastModified ?? new Date(),
          httpMetadata: { contentType: o.contentType },
          customMetadata: {},
          checksums: {},
        })),
        delimitedPrefixes: [],
        truncated: false,
      } as unknown as R2Objects
    }
    const page = await this.storage.listObjectsPage({
      ...(options?.prefix != null ? { prefix: options.prefix } : {}),
      ...(options?.delimiter != null ? { delimiter: options.delimiter } : {}),
      ...(options?.cursor != null ? { cursor: options.cursor } : {}),
      ...(options?.limit != null ? { limit: options.limit } : {}),
    })
    return {
      objects: page.objects.map((o) => ({
        key: o.key,
        size: o.size,
        etag: o.etag ?? '',
        uploaded: o.lastModified ?? new Date(),
        httpMetadata: { contentType: o.contentType },
        customMetadata: {},
        checksums: {},
      })),
      delimitedPrefixes: page.prefixes,
      truncated: page.truncated,
      ...(page.cursor ? { cursor: page.cursor } : {}),
    } as unknown as R2Objects
  }

  async ping?(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    return this.storage.ping?.() ?? { ok: true, latencyMs: 0 }
  }
}

export function asR2Bucket(storage: ObjectStorageProvider): R2Bucket {
  return new ObjectStorageR2BucketBridge(storage) as unknown as R2Bucket
}
