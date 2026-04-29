import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

  private async ensureFile(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    try {
      await readFile(this.filePath, 'utf8')
    } catch {
      await writeFile(this.filePath, JSON.stringify({ videos: {} }, null, 2))
    }
  }

  private async readAll(): Promise<TierMetadataFile> {
    await this.ensureFile()
    const raw = await readFile(this.filePath, 'utf8')
    try {
      const parsed = JSON.parse(raw) as Partial<TierMetadataFile>
      return { videos: parsed.videos ?? {} }
    } catch {
      return { videos: {} }
    }
  }

  private async writeAll(data: TierMetadataFile): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2))
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
    const data = await this.readAll()
    const existing = data.videos[videoId] ?? createEmptyRecord(videoId)
    data.videos[videoId] = {
      ...existing,
      tier,
      reason,
      updatedAt: nowIso(),
    }
    await this.writeAll(data)
  }
}
