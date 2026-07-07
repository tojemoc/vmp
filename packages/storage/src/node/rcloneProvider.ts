import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { StorageNotFoundError } from '../errors.js'
import type {
  GetObjectOptions,
  HeadObjectResult,
  ListedObject,
  ObjectStorageProvider,
  PutObjectOptions,
  StorageObjectResponse,
} from '../types.js'

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
  private readonly root: string
  private readonly binary: string

  constructor(options: RcloneProviderOptions) {
    this.root = options.root.replace(/\/+$/, '')
    this.binary = options.binary ?? 'rclone'
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

  async getObject(key: string, opts?: GetObjectOptions): Promise<StorageObjectResponse> {
    const normalized = normalizeKey(key)
    const head = await this.headObject(normalized)
    if (!head) throw new StorageNotFoundError(normalized)

    const args = ['cat', this.resolve(normalized)]
    if (opts?.range) args.push('--http-headers', `Range: ${opts.range}`)

    const child = spawn(this.binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const body = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    child.stderr.on('data', () => {})
    child.on('error', () => {})

    const headers = new Headers()
    headers.set('Content-Length', String(head.size))
    if (head.contentType) headers.set('Content-Type', head.contentType)
    if (head.lastModified) headers.set('Last-Modified', head.lastModified.toUTCString())

    return { status: opts?.range ? 206 : 200, headers, body }
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
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
    const result: HeadObjectResult = {
      key: normalized,
      size: Number(row.Size ?? 0),
    }
    if (row.MimeType) result.contentType = row.MimeType
    if (row.ModTime) result.lastModified = new Date(row.ModTime)
    return result
  }

  async putObject(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts?: PutObjectOptions,
  ): Promise<void> {
    const normalized = normalizeKey(key)
    const args = ['rcat', this.resolve(normalized)]
    if (opts?.contentType) args.push('--header-upload', `Content-Type: ${opts.contentType}`)

    const nodeStream = body instanceof Uint8Array
      ? Readable.from(body)
      : Readable.fromWeb(body as import('node:stream/web').ReadableStream)

    await this.run(args, `put ${normalized}`, nodeStream)
  }

  async deleteObject(key: string): Promise<void> {
    await this.run(['deletefile', this.resolve(normalizeKey(key))], `delete ${key}`)
  }

  async listObjects(keyPrefix: string): Promise<ListedObject[]> {
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
        const entry: ListedObject = { key, size: Number(row.Size ?? 0) }
        if (row.ModTime) entry.lastModified = new Date(row.ModTime)
        return entry
      })
  }
}
