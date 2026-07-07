export interface ObjectMetadata {
  key: string
  size: number
  etag?: string
  lastModified?: Date
  contentType?: string
}

export interface PutObjectOptions {
  contentType?: string
  metadata?: Record<string, string>
}

export interface ByteRange {
  offset: number
  length?: number
}

export interface GetObjectOptions {
  range?: ByteRange
}

export interface GetObjectResult {
  body: ReadableStream | Uint8Array | ArrayBuffer
  contentType?: string
  size?: number
  range?: { offset: number; length: number }
}

export interface ListObjectsPageOptions {
  prefix?: string
  delimiter?: string
  cursor?: string
  limit?: number
}

export interface ListObjectsPageResult {
  objects: ObjectMetadata[]
  prefixes: string[]
  truncated: boolean
  cursor?: string
}

export interface ObjectStorageProvider {
  readonly id: string

  getObject(key: string, opts?: GetObjectOptions): Promise<GetObjectResult | null>
  putObject(
    key: string,
    body: ReadableStream | Uint8Array | ArrayBuffer | string,
    opts?: PutObjectOptions,
  ): Promise<void>
  deleteObject(key: string): Promise<void>
  headObject(key: string): Promise<ObjectMetadata | null>
  listObjects(prefix: string): Promise<ObjectMetadata[]>
  listObjectsPage?(options: ListObjectsPageOptions): Promise<ListObjectsPageResult>
  deleteObjects?(keys: string[]): Promise<void>
  getSignedReadUrl(key: string, opts?: { expiresInSeconds?: number }): Promise<string>
  getSignedWriteUrl(key: string, opts?: { expiresInSeconds?: number }): Promise<string>
  ping?(): Promise<{ ok: boolean; latencyMs: number; error?: string }>
}

export type StorageProviderType = 'r2' | 'b2' | 's3-compatible'

export interface StorageProviderConfigBase {
  bucket: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle?: boolean
}

export type StorageProviderConfig =
  | ({ type: 'r2' } & StorageProviderConfigBase)
  | ({ type: 'b2' } & StorageProviderConfigBase)
  | ({ type: 's3-compatible'; id?: string } & StorageProviderConfigBase)
