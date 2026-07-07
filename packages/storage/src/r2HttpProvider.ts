import {
  isNotFoundHttpStatus,
  StorageAvailabilityError,
  StorageNotFoundError,
} from './errors.js'
import type {
  GetObjectOptions,
  HeadObjectResult,
  ObjectStorageProvider,
  PutObjectOptions,
  StorageObjectResponse,
} from './types.js'

export class R2HttpProvider implements ObjectStorageProvider {
  constructor(private readonly baseUrl: string) {}

  private objectUrl(key: string): string {
    const base = this.baseUrl.replace(/\/+$/, '')
    const normalized = key.replace(/^\/+/, '')
    return `${base}/${normalized}`
  }

  async getObject(key: string, opts?: GetObjectOptions): Promise<StorageObjectResponse> {
    const headers = new Headers()
    if (opts?.range) headers.set('Range', opts.range)

    let response: Response
    try {
      response = await fetch(this.objectUrl(key), { method: 'GET', headers })
    } catch (err) {
      throw new StorageAvailabilityError(key, `R2 HTTP fetch failed: ${String(err)}`)
    }

    if (isNotFoundHttpStatus(response.status)) {
      throw new StorageNotFoundError(key)
    }
    if (!response.ok) {
      throw new StorageAvailabilityError(key, `R2 HTTP returned ${response.status}`, response.status)
    }

    return {
      status: response.status,
      headers: new Headers(response.headers),
      body: response.body,
    }
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    let response: Response
    try {
      response = await fetch(this.objectUrl(key), { method: 'HEAD' })
    } catch {
      throw new StorageAvailabilityError(key, 'R2 HTTP HEAD failed')
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new StorageAvailabilityError(key, `R2 HTTP HEAD returned ${response.status}`, response.status)
    }
    const size = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
    const lastModifiedRaw = response.headers.get('last-modified')
    const result: HeadObjectResult = {
      key: key.replace(/^\/+/, ''),
      size: Number.isFinite(size) ? size : 0,
    }
    const contentType = response.headers.get('content-type')
    const etag = response.headers.get('etag')
    if (contentType) result.contentType = contentType
    if (etag) result.etag = etag
    if (lastModifiedRaw) result.lastModified = new Date(lastModifiedRaw)
    return result
  }

  async putObject(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts?: PutObjectOptions,
  ): Promise<void> {
    const headers = new Headers()
    if (opts?.contentType) headers.set('Content-Type', opts.contentType)
    if (opts?.cacheControl) headers.set('Cache-Control', opts.cacheControl)

    let response: Response
    try {
      response = await fetch(this.objectUrl(key), { method: 'PUT', headers, body: body as BodyInit })
    } catch (err) {
      throw new StorageAvailabilityError(key, `R2 HTTP PUT failed: ${String(err)}`)
    }
    if (!response.ok) {
      throw new StorageAvailabilityError(key, `R2 HTTP PUT returned ${response.status}`, response.status)
    }
  }

  async deleteObject(key: string): Promise<void> {
    let response: Response
    try {
      response = await fetch(this.objectUrl(key), { method: 'DELETE' })
    } catch (err) {
      throw new StorageAvailabilityError(key, `R2 HTTP DELETE failed: ${String(err)}`)
    }
    if (!response.ok && response.status !== 404) {
      throw new StorageAvailabilityError(key, `R2 HTTP DELETE returned ${response.status}`, response.status)
    }
  }
}
