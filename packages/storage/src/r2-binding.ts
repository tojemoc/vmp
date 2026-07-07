import type { R2Bucket, R2ListOptions } from '@cloudflare/workers-types'
import type {
  GetObjectOptions,
  GetObjectResult,
  ListObjectsPageOptions,
  ListObjectsPageResult,
  ObjectMetadata,
  ObjectStorageProvider,
  PutObjectOptions,
} from './types.js'

export class R2BindingStorageProvider implements ObjectStorageProvider {
  readonly id = 'r2'

  constructor(private readonly bucket: R2Bucket) {}

  async getObject(key: string, opts?: GetObjectOptions): Promise<GetObjectResult | null> {
    const range = opts?.range
    const object = await this.bucket.get(
      key,
      range && 'offset' in range
        ? { range: range.length != null
          ? { offset: range.offset, length: range.length }
          : { offset: range.offset } }
        : undefined,
    )
    if (!object) return null
  return {
      body: object.body as unknown as ReadableStream,
      ...(object.httpMetadata?.contentType ? { contentType: object.httpMetadata.contentType } : {}),
      ...(object.size != null ? { size: object.size } : {}),
      ...(object.range && 'offset' in object.range && typeof object.range.offset === 'number'
        ? {
          range: {
            offset: object.range.offset,
            length: typeof object.range.length === 'number' ? object.range.length : 0,
          },
        }
        : {}),
    }
  }

  async putObject(
    key: string,
    body: ReadableStream | Buffer | Uint8Array | string,
    opts?: PutObjectOptions,
  ): Promise<void> {
    const value = body instanceof Uint8Array || body instanceof ArrayBuffer
      ? body
      : body
    await this.bucket.put(key, value as Parameters<R2Bucket['put']>[1], {
      ...(opts?.contentType ? { httpMetadata: { contentType: opts.contentType } } : {}),
      ...(opts?.metadata ? { customMetadata: opts.metadata } : {}),
    })
  }

  async deleteObject(key: string): Promise<void> {
    await this.bucket.delete(key)
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    await this.bucket.delete(keys.length === 1 ? keys[0]! : keys)
  }

  async headObject(key: string): Promise<ObjectMetadata | null> {
    const object = await this.bucket.head(key)
    if (!object) return null
    return {
      key,
      size: object.size,
      etag: object.etag,
      lastModified: object.uploaded,
      ...(object.httpMetadata?.contentType ? { contentType: object.httpMetadata.contentType } : {}),
    }
  }

  async listObjects(prefix: string): Promise<ObjectMetadata[]> {
    const page = await this.listObjectsPage({ prefix })
    return page.objects
  }

  async listObjectsPage(options: ListObjectsPageOptions = {}): Promise<ListObjectsPageResult> {
    const r2Options: R2ListOptions = {}
    if (options.prefix != null) r2Options.prefix = options.prefix
    if (options.delimiter != null) r2Options.delimiter = options.delimiter
    if (options.cursor != null) r2Options.cursor = options.cursor
    if (options.limit != null) r2Options.limit = options.limit
    const listed = await this.bucket.list(r2Options)
    const cursor = 'cursor' in listed ? (listed as { cursor?: string }).cursor : undefined
    return {
      objects: listed.objects.map((o) => ({
        key: o.key,
        size: o.size,
        etag: o.etag,
        lastModified: o.uploaded,
        ...(o.httpMetadata?.contentType ? { contentType: o.httpMetadata.contentType } : {}),
      })),
      prefixes: listed.delimitedPrefixes ?? [],
      truncated: listed.truncated,
      ...(cursor ? { cursor } : {}),
    }
  }

  async getSignedReadUrl(): Promise<string> {
    throw new Error(
      'R2 Worker bindings do not support presigned URLs directly; configure an S3-compatible provider with credentials.',
    )
  }

  async getSignedWriteUrl(): Promise<string> {
    throw new Error(
      'R2 Worker bindings do not support presigned URLs directly; configure an S3-compatible provider with credentials.',
    )
  }
}

export function wrapR2Bucket(bucket: R2Bucket): ObjectStorageProvider {
  return new R2BindingStorageProvider(bucket)
}
