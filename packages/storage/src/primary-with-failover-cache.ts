import { isAvailabilityError } from './errors.js'
import { assertAllSettled } from './settled-errors.js'
import type {
  GetObjectOptions,
  GetObjectResult,
  ListObjectsPageOptions,
  ListObjectsPageResult,
  ObjectMetadata,
  ObjectStorageProvider,
  PrimaryHealthTracker,
  PutObjectOptions,
} from './types.js'

export interface PrimaryWithFailoverCacheOptions {
  id?: string
  logReplicationFailure?: (key: string, err: unknown) => void
}

export class PrimaryWithFailoverCache implements ObjectStorageProvider {
  readonly id: string
  private readonly options: PrimaryWithFailoverCacheOptions

  constructor(
    private readonly primary: ObjectStorageProvider,
    private readonly cache: ObjectStorageProvider,
    private readonly primaryHealth: PrimaryHealthTracker,
    options: PrimaryWithFailoverCacheOptions = {},
  ) {
    this.options = options
    this.id = options.id ?? `${primary.id}-with-${cache.id}-failover`
  }

  async getObject(key: string, opts?: GetObjectOptions): Promise<GetObjectResult | null> {
    if (await this.primaryHealth.isHealthy()) {
      try {
        const result = await this.primary.getObject(key, opts)
        await this.primaryHealth.recordSuccess()
        return result
      } catch (err) {
        await this.primaryHealth.recordFailure(err)
        if (!isAvailabilityError(err)) throw err
      }
    }
    return await this.cache.getObject(key, opts)
  }

  async headObject(key: string): Promise<ObjectMetadata | null> {
    if (await this.primaryHealth.isHealthy()) {
      try {
        const result = await this.primary.headObject(key)
        await this.primaryHealth.recordSuccess()
        return result
      } catch (err) {
        await this.primaryHealth.recordFailure(err)
        if (!isAvailabilityError(err)) throw err
      }
    }
    return await this.cache.headObject(key)
  }

  async getSignedReadUrl(key: string, opts?: { expiresInSeconds?: number }): Promise<string> {
    if (await this.primaryHealth.isHealthy()) {
      try {
        const head = await this.primary.headObject(key)
        await this.primaryHealth.recordSuccess()
        if (head) return await this.primary.getSignedReadUrl(key, opts)
      } catch (err) {
        await this.primaryHealth.recordFailure(err)
        if (!isAvailabilityError(err)) throw err
      }
    }
    return await this.cache.getSignedReadUrl(key, opts)
  }

  async getSignedWriteUrl(key: string, opts?: { expiresInSeconds?: number }): Promise<string> {
    return this.primary.getSignedWriteUrl(key, opts)
  }

  async putObject(
    key: string,
    body: ReadableStream | Uint8Array | ArrayBuffer | string,
    opts?: PutObjectOptions,
  ): Promise<void> {
    if (body instanceof ReadableStream) {
      const [primaryBody, cacheBody] = body.tee()
      await Promise.all([
        this.primary.putObject(key, primaryBody, opts),
        this.cache.putObject(key, cacheBody, opts).catch((err) => {
          this.logReplicationFailure(key, err)
        }),
      ])
      return
    }

    await this.primary.putObject(key, body, opts)
    try {
      await this.cache.putObject(key, body, opts)
    } catch (err) {
      this.logReplicationFailure(key, err)
    }
  }

  async deleteObject(key: string): Promise<void> {
    const results = await Promise.allSettled([
      this.primary.deleteObject(key),
      this.cache.deleteObject(key),
    ])
    assertAllSettled('deleteObject', results)
  }

  async deleteObjects(keys: string[]): Promise<void> {
    const results = await Promise.allSettled([
      this.primary.deleteObjects?.(keys) ?? Promise.all(keys.map((k) => this.primary.deleteObject(k))),
      this.cache.deleteObjects?.(keys) ?? Promise.all(keys.map((k) => this.cache.deleteObject(k))),
    ])
    assertAllSettled('deleteObjects', results)
  }

  async listObjects(prefix: string): Promise<ObjectMetadata[]> {
    if (await this.primaryHealth.isHealthy()) {
      try {
        const result = await this.primary.listObjects(prefix)
        await this.primaryHealth.recordSuccess()
        return result
      } catch (err) {
        await this.primaryHealth.recordFailure(err)
        if (!isAvailabilityError(err)) throw err
      }
    }
    return await this.cache.listObjects(prefix)
  }

  async listObjectsPage(options: ListObjectsPageOptions): Promise<ListObjectsPageResult> {
    if (await this.primaryHealth.isHealthy()) {
      try {
        if (this.primary.listObjectsPage) {
          const result = await this.primary.listObjectsPage(options)
          await this.primaryHealth.recordSuccess()
          return result
        }
        const objects = await this.primary.listObjects(options.prefix ?? '')
        await this.primaryHealth.recordSuccess()
        return {
          objects,
          prefixes: [],
          truncated: false,
        }
      } catch (err) {
        await this.primaryHealth.recordFailure(err)
        if (!isAvailabilityError(err)) throw err
      }
    }
    if (this.cache.listObjectsPage) {
      return this.cache.listObjectsPage(options)
    }
    const objects = await this.cache.listObjects(options.prefix ?? '')
    return {
      objects,
      prefixes: [],
      truncated: false,
    }
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    if (this.primary.ping) return this.primary.ping()
    return { ok: true, latencyMs: 0 }
  }

  private logReplicationFailure(key: string, err: unknown): void {
    const log = this.options.logReplicationFailure
    if (log) log(key, err)
    else console.error('[storage] cache replication failed', { key, err })
  }
}
