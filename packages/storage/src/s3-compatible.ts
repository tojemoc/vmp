import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'node:stream'
import type {
  GetObjectOptions,
  GetObjectResult,
  ListObjectsPageOptions,
  ListObjectsPageResult,
  ObjectMetadata,
  ObjectStorageProvider,
  PutObjectOptions,
} from './types.js'

export interface S3CompatibleStorageOptions {
  id: string
  bucket: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle?: boolean
  /** Optional injected client (tests). */
  client?: S3Client
}

function bodyToWebStream(body: unknown): ReadableStream | null {
  if (!body) return null
  if (body instanceof ReadableStream) return body
  if (typeof Readable !== 'undefined' && body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream
  }
  if (typeof body === 'string') return new Response(body).body
  if (body instanceof Uint8Array) return new Response(new Uint8Array(body)).body
  return new Response(body as BodyInit).body
}

function toS3PutBody(body: ReadableStream | Buffer | Uint8Array | string) {
  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return body
  }
  if (body instanceof ReadableStream) {
    return Readable.fromWeb(body as import('stream/web').ReadableStream)
  }
  throw new Error('Unsupported putObject body type')
}

function resolveContentLength(
  body: ReadableStream | Buffer | Uint8Array | string,
  opts?: PutObjectOptions,
): number | undefined {
  if (opts?.contentLength != null) return opts.contentLength
  if (typeof body === 'string') return Buffer.byteLength(body)
  if (Buffer.isBuffer(body)) return body.length
  if (body instanceof Uint8Array) return body.byteLength
  return undefined
}

function toObjectMetadata(key: string, head: {
  ContentLength?: number
  ETag?: string
  LastModified?: Date
  ContentType?: string
}): ObjectMetadata {
  return {
    key,
    size: head.ContentLength ?? 0,
    etag: head.ETag?.replace(/"/g, ''),
    lastModified: head.LastModified,
    contentType: head.ContentType,
  }
}

export class S3CompatibleStorageProvider implements ObjectStorageProvider {
  readonly id: string
  private readonly client: S3Client
  private readonly bucket: string

  constructor(options: S3CompatibleStorageOptions) {
    if (!options.bucket) throw new Error('S3CompatibleStorageProvider requires bucket')
    this.id = options.id
    this.bucket = options.bucket
    const credentials =
      options.accessKeyId && options.secretAccessKey
        ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
        : undefined
    this.client = options.client ?? new S3Client({
      region: options.region ?? 'auto',
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle ? { forcePathStyle: true } : {}),
      ...(credentials ? { credentials } : {}),
    })
  }

  async getObject(key: string, opts?: GetObjectOptions): Promise<GetObjectResult | null> {
    try {
      const range = opts?.range
      const out = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range
            ? {
                Range: range.length != null
                  ? `bytes=${range.offset}-${range.offset + range.length - 1}`
                  : `bytes=${range.offset}-`,
              }
            : {}),
        }),
      )
      const stream = bodyToWebStream(out.Body)
      if (!stream) return null
      const contentRange = out.ContentRange
      let parsedRange: { offset: number; length: number } | undefined
      if (contentRange) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange)
        if (match) {
          const offset = Number.parseInt(match[1]!, 10)
          const end = Number.parseInt(match[2]!, 10)
          parsedRange = { offset, length: end - offset + 1 }
        }
      }
      return {
        body: stream,
        contentType: out.ContentType,
        size: out.ContentLength,
        range: parsedRange,
      }
    } catch (err: unknown) {
      const code = (err as { name?: string }).name
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (code === 'NoSuchKey' || status === 404) return null
      throw err
    }
  }

  async putObject(
    key: string,
    body: ReadableStream | Buffer | Uint8Array | string,
    opts?: PutObjectOptions,
  ): Promise<void> {
    const contentLength = resolveContentLength(body, opts)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: toS3PutBody(body),
        ...(contentLength != null ? { ContentLength: contentLength } : {}),
        ContentType: opts?.contentType,
        CacheControl: opts?.cacheControl,
        Metadata: opts?.metadata,
      }),
    )
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    if (keys.length === 1) {
      await this.deleteObject(keys[0]!)
      return
    }
    const BATCH_SIZE = 1000
    const errors: { Key?: string; Code?: string; Message?: string }[] = []
    for (let offset = 0; offset < keys.length; offset += BATCH_SIZE) {
      const batch = keys.slice(offset, offset + BATCH_SIZE)
      const response = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: false },
        }),
      )
      if (response.Errors?.length) errors.push(...response.Errors)
    }
    if (errors.length > 0) {
      const detail = errors
        .map((e) => `${e.Key ?? '?'}: ${e.Code ?? 'Error'} ${e.Message ?? ''}`.trim())
        .join('; ')
      throw new Error(`S3 batch delete failed for ${errors.length} key(s): ${detail}`)
    }
  }

  async headObject(key: string): Promise<ObjectMetadata | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return toObjectMetadata(key, out)
    } catch (err: unknown) {
      const code = (err as { name?: string }).name
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (code === 'NotFound' || status === 404) return null
      throw err
    }
  }

  async listObjects(prefix: string): Promise<ObjectMetadata[]> {
    const page = await this.listObjectsPage({ prefix })
    return page.objects
  }

  async listObjectsPage(options: ListObjectsPageOptions = {}): Promise<ListObjectsPageResult> {
    const out = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: options.prefix ?? undefined,
        Delimiter: options.delimiter ?? undefined,
        ContinuationToken: options.cursor ?? undefined,
        MaxKeys: options.limit ?? 1000,
      }),
    )
    const objects = (out.Contents ?? [])
      .filter((o) => o.Key)
      .map((o) => toObjectMetadata(o.Key!, {
        ContentLength: o.Size,
        ETag: o.ETag,
        LastModified: o.LastModified,
      }))
    return {
      objects,
      prefixes: (out.CommonPrefixes ?? []).map((p) => p.Prefix!).filter(Boolean),
      truncated: Boolean(out.IsTruncated),
      cursor: out.NextContinuationToken,
    }
  }

  async getSignedReadUrl(key: string, opts?: { expiresInSeconds?: number }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: opts?.expiresInSeconds ?? 3600 },
    )
  }

  async getSignedWriteUrl(key: string, opts?: { expiresInSeconds?: number }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: opts?.expiresInSeconds ?? 3600 },
    )
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now()
    try {
      await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }))
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
