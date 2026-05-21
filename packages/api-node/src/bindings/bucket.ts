import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { R2ListOptions, R2Objects } from '@cloudflare/workers-types'
import { Readable } from 'node:stream'

export interface S3R2AdapterOptions {
  bucket: string
  region?: string
  endpoint?: string
  forcePathStyle?: boolean
}

function bodyToWebStream(body: unknown): ReadableStream | null {
  if (!body) return null
  if (body instanceof ReadableStream) return body
  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream
  }
  if (typeof body === 'string') {
    return new Response(body).body
  }
  if (body instanceof Uint8Array) {
    return new Response(new Uint8Array(body)).body
  }
  return new Response(body as BodyInit).body
}

async function readBodyAsBuffer(body: unknown): Promise<ArrayBuffer | Uint8Array | string> {
  if (!body) return new Uint8Array()
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return body
  if (body instanceof Readable) {
    const chunks: Buffer[] = []
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }
  const stream = bodyToWebStream(body)
  if (!stream) return new Uint8Array()
  return new Response(stream).arrayBuffer()
}

export class S3R2Adapter {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(options: S3R2AdapterOptions) {
    if (!options.bucket) {
      throw new Error('S3R2Adapter requires S3_BUCKET_NAME')
    }
    this.bucket = options.bucket
    this.client = new S3Client({
      region: options.region ?? process.env.AWS_REGION ?? 'us-east-1',
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle ? { forcePathStyle: true } : {}),
    })
  }

  async head(key: string): Promise<Record<string, unknown> | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return {
        key,
        size: out.ContentLength ?? 0,
        etag: out.ETag?.replace(/"/g, '') ?? '',
        uploaded: out.LastModified ?? new Date(),
        httpMetadata: { contentType: out.ContentType },
        customMetadata: {},
        range: undefined,
        checksums: {},
        writeHttpMetadata: (headers: Headers) => {
          if (out.ContentType) headers.set('Content-Type', out.ContentType)
        },
        body: null,
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => '',
        json: async () => ({}),
        blob: async () => new Blob(),
      }
    } catch (err: unknown) {
      const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } }).name
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (code === 'NotFound' || status === 404) return null
      throw err
    }
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      const stream = bodyToWebStream(out.Body)
      const httpMetadata = { contentType: out.ContentType }
      return {
        key,
        size: out.ContentLength ?? 0,
        etag: out.ETag?.replace(/"/g, '') ?? '',
        uploaded: out.LastModified ?? new Date(),
        httpMetadata,
        customMetadata: {},
        body: stream,
        arrayBuffer: async () => {
          const buf = await readBodyAsBuffer(out.Body)
          if (buf instanceof ArrayBuffer) return buf
          if (typeof buf === 'string') return new TextEncoder().encode(buf).buffer
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        },
        text: async () => {
          const buf = await readBodyAsBuffer(out.Body)
          return typeof buf === 'string' ? buf : new TextDecoder().decode(buf)
        },
        json: async () => {
          const buf = await readBodyAsBuffer(out.Body)
          const text = typeof buf === 'string' ? buf : new TextDecoder().decode(buf)
          return JSON.parse(text) as unknown
        },
        blob: async () => {
          const buf = await readBodyAsBuffer(out.Body)
          const part =
            buf instanceof ArrayBuffer
              ? buf
              : typeof buf === 'string'
                ? buf
                : new Uint8Array(buf)
          return new Blob([part as BlobPart])
        },
        writeHttpMetadata: (headers: Headers) => {
          if (out.ContentType) headers.set('Content-Type', out.ContentType)
        },
      }
    } catch (err: unknown) {
      const code = (err as { name?: string }).name
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (code === 'NoSuchKey' || status === 404) return null
      throw err
    }
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<Record<string, unknown> | null> {
    const body = await readBodyAsBuffer(value)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body instanceof ArrayBuffer ? Buffer.from(body) : body,
        ContentType: options?.httpMetadata?.contentType,
        Metadata: options?.customMetadata,
      }),
    )
    return this.head(key)
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys]
    if (list.length === 0) return
    if (list.length === 1) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: list[0] }))
      return
    }
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: list.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    )
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const out = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: options?.prefix ?? undefined,
        Delimiter: options?.delimiter ?? undefined,
        ContinuationToken: options?.cursor ?? undefined,
        MaxKeys: options?.limit ?? 1000,
      }),
    )
    const objects = (out.Contents ?? []).map((o) => ({
      key: o.Key!,
      size: o.Size ?? 0,
      etag: o.ETag?.replace(/"/g, '') ?? '',
      uploaded: o.LastModified ?? new Date(),
      httpMetadata: {},
      customMetadata: {},
      checksums: {},
    }))
    const delimitedPrefixes = (out.CommonPrefixes ?? []).map((p) => p.Prefix!).filter(Boolean)
    return {
      objects,
      delimitedPrefixes,
      truncated: Boolean(out.IsTruncated),
      cursor: out.NextContinuationToken ?? undefined,
    } as R2Objects
  }

  /** Quick connectivity check for health endpoint. */
  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now()
    try {
      await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }))
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

// TODO: dual-write to R2 and S3 during normal operation so failover bucket stays warm.
