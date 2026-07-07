import { isAvailabilityError } from './errors.js'
import type {
  GetObjectOptions,
  ObjectStorageProvider,
  PrimaryHealthTracker,
  PutObjectOptions,
  StorageObjectResponse,
} from './types.js'

export interface PrimaryWithFailoverCacheOptions {
  logReplicationFailure?: (key: string, err: unknown) => void
}

export class PrimaryWithFailoverCache implements ObjectStorageProvider {
  constructor(
    private readonly primary: ObjectStorageProvider,
    private readonly cache: ObjectStorageProvider,
    private readonly primaryHealth: PrimaryHealthTracker,
    private readonly options: PrimaryWithFailoverCacheOptions = {},
  ) {}

  async getObject(key: string, opts?: GetObjectOptions): Promise<StorageObjectResponse> {
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

  async headObject(key: string) {
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

  async putObject(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts?: PutObjectOptions,
  ): Promise<void> {
    if (body instanceof Uint8Array) {
      await this.primary.putObject(key, body, opts)
      try {
        await this.cache.putObject(key, body, opts)
      } catch (err) {
        this.logReplicationFailure(key, err)
      }
      return
    }

    const [primaryBody, cacheBody] = body.tee()
    await this.primary.putObject(key, primaryBody, opts)
    try {
      await this.cache.putObject(key, cacheBody, opts)
    } catch (err) {
      this.logReplicationFailure(key, err)
    }
  }

  private logReplicationFailure(key: string, err: unknown): void {
    const log = this.options.logReplicationFailure
    if (log) log(key, err)
    else console.error('[storage] cache replication failed', { key, err })
  }

  async deleteObject(key: string): Promise<void> {
    await Promise.allSettled([
      this.primary.deleteObject(key),
      this.cache.deleteObject(key),
    ])
  }
}
