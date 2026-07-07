import type { ObjectMetadata } from './types.js'
import type { OffloadPolicy } from './offloadPolicy.js'
import type { ObjectStorageProvider } from './types.js'

export interface OffloadMoveResult {
  key: string
  moved: boolean
  skipped?: string
  error?: string
}

export interface ObjectOffloadJobOptions {
  hot: ObjectStorageProvider
  cold: ObjectStorageProvider
  policy: OffloadPolicy
  listPrefix: string
  deleteHotAfterOffload?: boolean
  dryRun?: boolean
  signal?: AbortSignal
  log?: (message: string, extra?: Record<string, unknown>) => void
}

export class ObjectOffloadJob {
  constructor(private readonly options: ObjectOffloadJobOptions) {}

  async run(): Promise<OffloadMoveResult[]> {
    const {
      hot,
      cold,
      policy,
      listPrefix,
      deleteHotAfterOffload = true,
      dryRun = false,
      signal,
      log = () => {},
    } = this.options

    const results: OffloadMoveResult[] = []
    const listed = await hot.listObjects(listPrefix)

    for (const entry of listed) {
      if (signal?.aborted) break

      const head = await hot.headObject(entry.key)
      if (!head?.lastModified) {
        results.push({ key: entry.key, moved: false, skipped: 'missing_last_modified' })
        continue
      }

      const meta: ObjectMetadata = {
        ...head,
        lastModified: head.lastModified,
      }

      if (!policy.shouldOffload(meta)) {
        results.push({ key: entry.key, moved: false, skipped: 'policy' })
        continue
      }

      const ageSeconds = (Date.now() - meta.lastModified.getTime()) / 1000
      log('offload candidate', {
        key: entry.key,
        ageSeconds: Math.floor(ageSeconds),
        size: meta.size,
      })

      if (dryRun) {
        results.push({ key: entry.key, moved: false, skipped: 'dry_run' })
        continue
      }

      try {
        const object = await hot.getObject(entry.key)
        if (!object.body) {
          results.push({ key: entry.key, moved: false, error: 'empty_body' })
          continue
        }

        const contentType = object.headers.get('content-type') ?? undefined
        const putOpts = contentType ? { contentType } : undefined
        await cold.putObject(entry.key, object.body, putOpts)

        const coldHead = await cold.headObject(entry.key)
        if (!coldHead || coldHead.size !== meta.size) {
          results.push({ key: entry.key, moved: false, error: 'verify_failed' })
          continue
        }

        if (deleteHotAfterOffload) {
          await hot.deleteObject(entry.key)
        }

        log('offload complete', {
          key: entry.key,
          ageSeconds: Math.floor(ageSeconds),
          size: meta.size,
          deletedFromHot: deleteHotAfterOffload,
        })
        results.push({ key: entry.key, moved: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('offload failed', { key: entry.key, error: message })
        results.push({ key: entry.key, moved: false, error: message })
      }
    }

    return results
  }
}
