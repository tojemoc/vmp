import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import type {
  GetObjectOptions,
  GetObjectResult,
  ObjectMetadata,
  ObjectStorageProvider,
  PutObjectOptions,
} from './types.js'

function trimLeadingSlashes(value: string): string {
  let start = 0
  while (start < value.length && value[start] === '/') start++
  return start === 0 ? value : value.slice(start)
}

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return end === value.length ? value : value.slice(0, end)
}

function normalizePrefix(value: string): string {
  return trimTrailingSlashes(trimLeadingSlashes(value))
}

function normalizeKey(key: string): string {
  return trimLeadingSlashes(key)
}

function collapseSlashes(path: string): string {
  let out = ''
  let prevSlash = false
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]!
    if (ch === '/') {
      if (!prevSlash) out += ch
      prevSlash = true
    } else {
      out += ch
      prevSlash = false
    }
  }
  return out
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
    this.root = trimTrailingSlashes(options.root)
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
        child.stdin.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EPIPE') return
          reject(err)
        })
      } else {
        child.stdin.end()
      }
    })
  }

  private spawnCatStream(args: string[], label: string): ReadableStream<Uint8Array> {
    const child = spawn(this.binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    let stderr = ''
    let closed = false

    const fail = (controller: ReadableStreamDefaultController<Uint8Array>, err: unknown) => {
      if (closed) return
      closed = true
      child.kill()
      controller.error(err)
    }

    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    return new ReadableStream<Uint8Array>({
      start(controller) {
        child.stdout.on('data', (chunk: Buffer) => {
          if (closed) return
          try {
            controller.enqueue(new Uint8Array(chunk))
            if (controller.desiredSize !== null && controller.desiredSize <= 0) {
              child.stdout.pause()
            }
          } catch (err) {
            fail(controller, err)
          }
        })
        child.stdout.on('end', () => {
          child.stdout.pause()
        })
        child.on('error', (err) => fail(controller, err))
        child.on('close', (code) => {
          if (closed) return
          closed = true
          if (code === 0) controller.close()
          else controller.error(new Error(`${label} failed (${code}): ${stderr.slice(-400)}`))
        })
      },
      pull() {
        child.stdout.resume()
      },
      cancel() {
        if (!closed) {
          closed = true
          child.kill()
        }
      },
    })
  }

  async getObject(key: string, opts?: GetObjectOptions): Promise<GetObjectResult | null> {
    const normalized = normalizeKey(key)
    const head = await this.headObject(normalized)
    if (!head) return null

    const args = ['cat', this.resolve(normalized)]
    if (opts?.range) {
      args.push('--offset', String(opts.range.offset))
      if (opts.range.length != null) {
        args.push('--count', String(opts.range.length))
      }
    }

    const body = this.spawnCatStream(args, `cat ${normalized}`)

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
    try {
      const stdout = await this.run(['lsjson', this.resolve(normalized)], `stat ${normalized}`)
      const rows = JSON.parse(stdout) as Array<{
        Name: string
        Size?: number
        IsDir?: boolean
        ModTime?: string
        MimeType?: string
      }>
      if (!Array.isArray(rows)) return null
      const row = rows.find((entry) => !entry.IsDir)
      if (!row) return null
      const result: ObjectMetadata = {
        key: normalized,
        size: Number(row.Size ?? 0),
      }
      if (row.MimeType) result.contentType = row.MimeType
      if (row.ModTime) result.lastModified = new Date(row.ModTime)
      return result
    } catch {
      return null
    }
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
    const base = normalizePrefix(keyPrefix)
    const results: ObjectMetadata[] = []
    const queue: Array<{ path: string; relative: string }> = [
      { path: this.resolve(base), relative: base },
    ]

    while (queue.length > 0) {
      const { path, relative } = queue.shift()!
      const stdout = await this.run(['lsjson', path], `list ${path}`)
      const rows = JSON.parse(stdout) as Array<{
        Name: string
        Size?: number
        IsDir?: boolean
        ModTime?: string
      }>

      for (const row of rows) {
        if (row.IsDir) {
          const childRelative = relative ? `${relative}/${row.Name}` : row.Name
          queue.push({ path: `${path}/${row.Name}`, relative: childRelative })
          continue
        }
        const key = collapseSlashes(relative ? `${relative}/${row.Name}` : row.Name)
        const entry: ObjectMetadata = { key, size: Number(row.Size ?? 0) }
        if (row.ModTime) entry.lastModified = new Date(row.ModTime)
        results.push(entry)
      }
    }

    return results
  }

  async getSignedReadUrl(): Promise<string> {
    throw new Error('RcloneProvider does not support signed URLs')
  }

  async getSignedWriteUrl(): Promise<string> {
    throw new Error('RcloneProvider does not support signed URLs')
  }
}
