import { dedupeByKey } from './dedupeByKey.js'
import { isNotFoundError } from './errors.js'
import type {
  GetObjectOptions,
  HeadObjectResult,
  ListedObject,
  ObjectStorageProvider,
  PutObjectOptions,
  StorageObjectResponse,
} from './types.js'

export class TieredStorageProvider implements ObjectStorageProvider {
  constructor(
    private readonly hot: ObjectStorageProvider,
    private readonly cold: ObjectStorageProvider,
  ) {}

  async getObject(key: string, opts?: GetObjectOptions): Promise<StorageObjectResponse> {
    try {
      return await this.hot.getObject(key, opts)
    } catch (err) {
      if (!isNotFoundError(err)) throw err
      return await this.cold.getObject(key, opts)
    }
  }

  async putObject(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts?: PutObjectOptions,
  ): Promise<void> {
    await this.hot.putObject(key, body, opts)
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
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

  async listObjects(prefix: string): Promise<ListedObject[]> {
    const [hotList, coldList] = await Promise.all([
      this.hot.listObjects(prefix),
      this.cold.listObjects(prefix),
    ])
    return dedupeByKey([...hotList, ...coldList])
  }
}
