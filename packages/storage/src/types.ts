export interface GetObjectOptions {
  range?: string
}

export interface PutObjectOptions {
  contentType?: string
  cacheControl?: string
}

export interface HeadObjectResult {
  key: string
  size: number
  contentType?: string
  etag?: string
  lastModified?: Date
}

export interface StorageObjectResponse {
  status: number
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

export interface ObjectStorageProvider {
  getObject(key: string, opts?: GetObjectOptions): Promise<StorageObjectResponse>
  headObject(key: string): Promise<HeadObjectResult | null>
  putObject(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts?: PutObjectOptions,
  ): Promise<void>
  deleteObject(key: string): Promise<void>
}

export interface PrimaryHealthTracker {
  isHealthy(): Promise<boolean>
  recordFailure(err: unknown): Promise<void>
  recordSuccess(): Promise<void>
}
