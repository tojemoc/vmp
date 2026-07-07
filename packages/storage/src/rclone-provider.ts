import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import type {
  GetObjectOptions,
  GetObjectResult,
  ObjectMetadata,
  ObjectStorageProvider,
  PutObjectOptions,
} from './types.js'

function normalizePrefix(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '')
}

function normalizeKey(key: string): string {
  return key.replace(/^\/+/, '')
}

export interface RcloneProviderOptions {
  root: string
  binary?: string
}

export class RcloneProvider implements ObjectStorageProvider {
  readonly id: string
  private readonly root: string
  private readonly binary: string

  constructor(options: RcloneProviderOptions) {
    this.root = options.root.replace(/\/+$/, '')
    this.binary = options.binary ?? 'rclone'
    this.id = `rclone:${this.root}`
  }

  private resolve(key: string): string {
    return `${this.root}/${normalizeKey(key)}`
  }

  private async run(args: string[], label: string, stdin?: Readable): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(this.binary, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`${label} failed (${code}): ${stderr.slice(-400)}`))
      })
      if (stdin) {
        stdin.pipe(child.stdin)
        stdin.on('error', reject)
      } else {
        child.stdin.end()
      }
    })
  }

  async getObject(key: string, opts?: GetObjectOptions): Promise<GetObjectResult | null> {
    const normalized = normalizeKey(key)
    const head = await this.headObject(normalized)
    if (!head) return null

    const args = ['cat', this.resolve(normalized)]
    if (opts?.range) {
      const { offset, length } = opts.range
      const end = length != null ? offset + length - 1 : ''
      args.push('--http-headers', `Range: bytes=${offset}-${end}`)
    }

    const child = spawn(this.binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const body = Readable.toWeb(child.stdout) as ReadableStream
    child.stderr.on('data', () => {})
    child.on('error', () => {})

    const result: GetObjectResult = {
      body,
      size: head.size,
    }
    if (head.contentType) result.contentType = head.contentType
    if (opts?.range) {
      result.range = {
        offset: opts.range.offset,
        length: opts.range.length ?? head.size - opts.range.offset,
      }
    }
    return result
  }

  async headObject(key: string): Promise<ObjectMetadata | null> {
    const normalized = normalizeKey(key)
    let stdout: string
    try {
      stdout = await this.run(['lsjson', this.resolve(normalized)], `stat ${normalized}`)
    } catch {
      return null
    }
    const rows = JSON.parse(stdout) as Array<{
      Name: string
      Size?: number
      IsDir?: boolean
      ModTime?: string
      MimeType?: string
    }>
    const row = rows.find((entry) => !entry.IsDir)
    if (!row) return null
    const result: ObjectMetadata = {
      key: normalized,
      size: Number(row.Size ?? 0),
    }
    if (row.MimeType) result.contentType = row.MimeType
    if (row.ModTime) result.lastModified = new Date(row.ModTime)
    return result
  }

  async putObject(
    key: string,
    body: ReadableStream | Uint8Array | ArrayBuffer | string,
    opts?: PutObjectOptions,
  ): Promise<void> {
    const normalized = normalizeKey(key)
    const args = ['rcat', this.resolve(normalized)]
    if (opts?.contentType) args.push('--header-upload', `Content-Type: ${opts.contentType}`)

    let nodeStream: Readable
    if (typeof body === 'string' || body instanceof Uint8Array || Buffer.isBuffer(body)) {
      nodeStream = Readable.from(body)
    } else if (body instanceof ReadableStream) {
      nodeStream = Readable.fromWeb(body as import('node:stream/web').ReadableStream)
    } else {
      nodeStream = Readable.from(new Uint8Array(body))
    }

    await this.run(args, `put ${normalized}`, nodeStream)
  }

  async deleteObject(key: string): Promise<void> {
    await this.run(['deletefile', this.resolve(normalizeKey(key))], `delete ${key}`)
  }

  async listObjects(keyPrefix: string): Promise<ObjectMetadata[]> {
    const target = this.resolve(normalizePrefix(keyPrefix))
    const stdout = await this.run(['lsjson', '-R', target], `list ${target}`)
    const rows = JSON.parse(stdout) as Array<{
      Path: string
      Name: string
      Size?: number
      IsDir?: boolean
      ModTime?: string
    }>
    const base = normalizePrefix(keyPrefix)
    return rows
      .filter((row) => !row.IsDir)
      .map((row) => {
        const key = `${base}/${row.Path || row.Name}`.replace(/\/{2,}/g, '/')
        const entry: ObjectMetadata = { key, size: Number(row.Size ?? 0) }
        if (row.ModTime) entry.lastModified = new Date(row.ModTime)
        return entry
      })
  }

  async getSignedReadUrl(): Promise<string> {
    throw new Error('RcloneProvider does not support signed URLs')
  }

  async getSignedWriteUrl(): Promise<string> {
    throw new Error('RcloneProvider does not support signed URLs')
  }
}
