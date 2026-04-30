import crypto from 'node:crypto'
import { runCommand } from './util.js'

function normalizePrefix(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '')
}

export interface ObjectMeta {
  key: string
  size: number
}

export class StorageClient {
  constructor(
    private readonly root: string,
    private readonly binary = 'rclone',
    private readonly tmpDir = '/tmp/vmp-offloading',
  ) {}

  private resolve(key: string): string {
    return `${this.root}/${normalizePrefix(key)}`
  }

  async listObjects(keyPrefix: string): Promise<ObjectMeta[]> {
    const target = this.resolve(keyPrefix)
    const stdout = await runCommand(this.binary, ['lsjson', '-R', target], `list objects ${target}`)
    const rows = JSON.parse(stdout) as Array<{ Path: string; Name: string; Size?: number; IsDir?: boolean }>
    return rows
      .filter((row) => !row.IsDir)
      .map((row) => ({
        key: `${normalizePrefix(keyPrefix)}/${row.Path || row.Name}`.replace(/\/{2,}/g, '/'),
        size: Number(row.Size ?? 0),
      }))
  }

  async copyObject(sourceKey: string, destination: StorageClient, destinationKey: string): Promise<void> {
    await runCommand(
      this.binary,
      ['copyto', this.resolve(sourceKey), destination.resolve(destinationKey)],
      `copy ${sourceKey}`,
    )
  }

  async statObject(key: string): Promise<ObjectMeta | null> {
    const target = this.resolve(key)
    const stdout = await runCommand(this.binary, ['lsjson', target], `stat ${target}`)
    const rows = JSON.parse(stdout) as Array<{ Name: string; Size?: number; IsDir?: boolean }>
    const row = rows.find((entry) => !entry.IsDir)
    if (!row) return null
    return {
      key: normalizePrefix(key),
      size: Number(row.Size ?? 0),
    }
  }

  async copyToTemp(key: string): Promise<string> {
    const suffix = crypto.randomBytes(8).toString('hex')
    const localPath = `${this.tmpDir}/${normalizePrefix(key).replace(/\//g, '__')}.${suffix}`
    await runCommand(this.binary, ['copyto', this.resolve(key), localPath], `copy to temp ${key}`)
    return localPath
  }

  async cleanupTemp(localPath: string): Promise<void> {
    await runCommand('rm', ['-f', localPath], `cleanup ${localPath}`)
  }

  async deleteObject(key: string): Promise<void> {
    const target = this.resolve(key)
    await runCommand(this.binary, ['deletefile', target], `delete ${target}`)
  }
}
