import { dedupeByKey } from './dedupeByKey.js'
import type {
  GetObjectOptions,
  GetObjectResult,
  ListObjectsPageOptions,
  ListObjectsPageResult,
  ObjectMetadata,
  ObjectStorageProvider,
  PutObjectOptions,
} from './types.js'

export class TieredStorageProvider implements ObjectStorageProvider {
  readonly id: string

  constructor(
    private readonly hot: ObjectStorageProvider,
    private readonly cold: ObjectStorageProvider,
  ) {
    this.id = `${hot.id}-tiered-over-${cold.id}`
  }

  async getObject(key: string, opts?: GetObjectOptions): Promise<GetObjectResult | null> {
    const hotResult = await this.hot.getObject(key, opts)
    if (hotResult) return hotResult
    return await this.cold.getObject(key, opts)
  }

  async putObject(
    key: string,
    body: ReadableStream | Uint8Array | ArrayBuffer | string,
    opts?: PutObjectOptions,
  ): Promise<void> {
    await this.hot.putObject(key, body, opts)
  }

  async headObject(key: string): Promise<ObjectMetadata | null> {
    const hotHead = await this.hot.headObject(key)
    if (hotHead) return hotHead
    return await this.cold.headObject(key)
  }

  async deleteObject(key: string): Promise<void> {
    await Promise.allSettled([
      this.hot.deleteObject(key),
      this.cold.deleteObject(key),
    ])
  }

  async deleteObjects(keys: string[]): Promise<void> {
    await Promise.allSettled([
      this.hot.deleteObjects?.(keys) ?? Promise.all(keys.map((k) => this.hot.deleteObject(k))),
      this.cold.deleteObjects?.(keys) ?? Promise.all(keys.map((k) => this.cold.deleteObject(k))),
    ])
  }

  async listObjects(prefix: string): Promise<ObjectMetadata[]> {
    const [hotList, coldList] = await Promise.all([
      this.hot.listObjects(prefix),
      this.cold.listObjects(prefix),
    ])
    return dedupeByKey([...hotList, ...coldList])
  }

  async listObjectsPage(options: ListObjectsPageOptions): Promise<ListObjectsPageResult> {
    if (this.hot.listObjectsPage) {
      return this.hot.listObjectsPage(options)
    }
    const objects = await this.listObjects(options.prefix ?? '')
    return { objects, prefixes: [], truncated: false }
  }

  async getSignedReadUrl(key: string, opts?: { expiresInSeconds?: number }): Promise<string> {
    if (await this.hot.headObject(key)) {
      return this.hot.getSignedReadUrl(key, opts)
    }
    return this.cold.getSignedReadUrl(key, opts)
  }

  async getSignedWriteUrl(key: string, opts?: { expiresInSeconds?: number }): Promise<string> {
    return this.hot.getSignedWriteUrl(key, opts)
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    if (this.hot.ping) return this.hot.ping()
    return { ok: true, latencyMs: 0 }
  }
}
