import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RequestCounters } from './types.js'

export class MetricsStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Record<string, RequestCounters>> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return JSON.parse(raw) as Record<string, RequestCounters>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  async save(data: Record<string, RequestCounters>): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  }

  async get(videoId: string): Promise<RequestCounters> {
    const data = await this.load()
    return data[videoId] ?? {
      rpm1m: 0,
      rpm10m: 0,
      rpm24h: 0,
    }
  }
}
