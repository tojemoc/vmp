import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type { TierMetadata, StorageTier } from './types.js'

interface TierMetadataFile {
  videos: Record<string, TierMetadata>
}

function nowIso(): string {
  return new Date().toISOString()
}

function createEmptyRecord(videoId: string): TierMetadata {
  return {
    videoId,
    tier: 'hot',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    counters: {
      rpm1m: 0,
      rpm10m: 0,
      rpm24h: 0,
      lastMinuteBucket: '',
      minuteBuckets: [],
      recentMinuteBuckets: [],
    },
  }
}

export class MetadataStore {
  constructor(private readonly filePath: string) {}

  private async withFileLock<T>(fn: (lockHandle: FileHandle) => Promise<T>): Promise<T> {
    const lockPath = `${this.filePath}.lock`
    await mkdir(path.dirname(lockPath), { recursive: true })

    const maxRetries = 50
    const retryDelayMs = 100
    const staleLockThresholdMs = 30000 // 30 seconds

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Attempt to acquire an exclusive lock (wx = write, exclusive - fails if file exists)
        const lockHandle = await open(lockPath, 'wx')
        try {
          return await fn(lockHandle)
        } finally {
          await lockHandle.close()
          // Release the lock by removing the lock file
          await rm(lockPath, { force: true })
        }
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
          // Lock file exists, check if it's stale
          try {
            const lockStat = await stat(lockPath)
            const lockAge = Date.now() - lockStat.mtimeMs
            if (lockAge > staleLockThresholdMs) {
              // Stale lock detected, remove and retry immediately
              await unlink(lockPath)
              // Don't increment attempt counter, retry immediately
              continue
            }
          } catch (statErr) {
            // Lock file might have been removed by another process, retry
            continue
          }

          // Lock file exists and is recent, another process holds the lock
          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
            continue
          } else {
            throw new Error(`Failed to acquire file lock after ${maxRetries} attempts`)
          }
        }
        throw err
      }
    }
    throw new Error('Unexpected: loop exited without result')
  }

  private async ensureFile(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      await readFile(this.filePath, 'utf8')
    } catch (err) {
      // Only initialize the file if it doesn't exist; rethrow other errors (permission, I/O, etc.)
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        await writeFile(this.filePath, JSON.stringify({ videos: {} }, null, 2))
      } else {
        throw err
      }
    }
  }

  private async readAll(): Promise<TierMetadataFile> {
    await this.ensureFile()
    const raw = await readFile(this.filePath, 'utf8')
    try {
      const parsed = JSON.parse(raw) as Partial<TierMetadataFile>
      // Validate that parsed.videos is a non-null object and not an Array
      const isValidVideos = typeof parsed.videos === 'object' && parsed.videos !== null && !Array.isArray(parsed.videos)
      return { videos: isValidVideos ? (parsed.videos as Record<string, TierMetadata>) : {} }
    } catch (err) {
      throw new Error(`Failed to parse metadata file ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async writeAll(data: TierMetadataFile): Promise<void> {
    const dirPath = path.dirname(this.filePath)
    const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`
    const encoded = JSON.stringify(data, null, 2)
    const fileHandle = await open(tempPath, 'w')
    try {
      await fileHandle.writeFile(encoded, 'utf8')
      // Best-effort durability before atomic rename.
      await fileHandle.sync()
    } finally {
      await fileHandle.close()
    }

    // Perform atomic rename with its own error handling
    try {
      await rename(tempPath, this.filePath)
    } catch (error) {
      await rm(tempPath, { force: true })
      throw error
    }

    // Best-effort directory sync to persist the rename operation.
    // Errors here do not affect the successful rename.
    try {
      const dirHandle = await open(dirPath, 'r')
      try {
        await dirHandle.sync()
      } finally {
        await dirHandle.close()
      }
    } catch (syncError) {
      // Log or ignore sync errors - the rename already succeeded
    }
  }

  async get(videoId: string): Promise<TierMetadata> {
    const data = await this.readAll()
    return data.videos[videoId] ?? createEmptyRecord(videoId)
  }

  async list(): Promise<TierMetadata[]> {
    const data = await this.readAll()
    return Object.values(data.videos)
  }

  async upsertTier(videoId: string, tier: StorageTier, reason?: string): Promise<void> {
    await this.withFileLock(async () => {
      const data = await this.readAll()
      const existing = data.videos[videoId] ?? createEmptyRecord(videoId)
      data.videos[videoId] = {
        ...existing,
        tier,
        reason,
        updatedAt: nowIso(),
      }
      await this.writeAll(data)
    })
  }
}
