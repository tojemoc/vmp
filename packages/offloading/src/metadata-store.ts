import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  private async withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release = (): void => {}
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
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
      return { videos: parsed.videos ?? {} }
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

    try {
      await rename(tempPath, this.filePath)
      // Best-effort directory sync to persist the rename operation.
      const dirHandle = await open(dirPath, 'r')
      try {
        await dirHandle.sync()
      } finally {
        await dirHandle.close()
      }
    } catch (error) {
      await rm(tempPath, { force: true })
      throw error
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
    await this.withMutationLock(async () => {
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
