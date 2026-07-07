import { AwsClient } from 'aws4fetch'
import {
  isNotFoundHttpStatus,
  StorageAvailabilityError,
  StorageNotFoundError,
} from './errors.js'
import type {
  GetObjectOptions,
  HeadObjectResult,
  ListedObject,
  ObjectStorageProvider,
  PutObjectOptions,
  StorageObjectResponse,
} from './types.js'

export interface S3FetchProviderConfig {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

function normalizeKey(key: string): string {
  return key.replace(/^\/+/, '')
}

function buildListUrl(config: S3FetchProviderConfig, prefix: string, continuationToken?: string): string {
  const endpoint = config.endpoint.replace(/\/+$/, '')
  const bucket = config.bucket.replace(/^\/+|\/+$/g, '')
  const base = endpoint.includes(bucket) ? endpoint : `${endpoint}/${bucket}`
  const params = new URLSearchParams({ 'list-type': '2', prefix: normalizeKey(prefix) })
  if (continuationToken) params.set('continuation-token', continuationToken)
  return `${base}?${params.toString()}`
}

function parseListObjectsXml(xml: string): { objects: ListedObject[]; truncated: boolean; nextToken?: string } {
  const objects: ListedObject[] = []
  const contentsBlocks = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []
  for (const block of contentsBlocks) {
    const key = block.match(/<Key>([^<]*)<\/Key>/)?.[1]
    if (!key) continue
    const size = Number.parseInt(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? '0', 10)
    const lastModifiedRaw = block.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1]
    const entry: ListedObject = {
      key,
      size: Number.isFinite(size) ? size : 0,
    }
    if (lastModifiedRaw) entry.lastModified = new Date(lastModifiedRaw)
    objects.push(entry)
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml)
  const nextToken = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1]
  const result: { objects: ListedObject[]; truncated: boolean; nextToken?: string } = {
    objects,
    truncated,
  }
  if (nextToken) result.nextToken = nextToken
  return result
}

function buildObjectUrl(config: S3FetchProviderConfig, key: string): string {
  const endpoint = config.endpoint.replace(/\/+$/, '')
  const bucket = config.bucket.replace(/^\/+|\/+$/g, '')
  const objectKey = normalizeKey(key)
  if (endpoint.includes(bucket)) {
    return `${endpoint}/${objectKey}`
  }
  return `${endpoint}/${bucket}/${objectKey}`
}

export class S3FetchProvider implements ObjectStorageProvider {
  private readonly client: AwsClient
  private readonly config: S3FetchProviderConfig

  constructor(config: S3FetchProviderConfig) {
    this.config = config
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region ?? 'us-east-1',
      service: 's3',
    })
  }

  async getObject(key: string, opts?: GetObjectOptions): Promise<StorageObjectResponse> {
    const url = buildObjectUrl(this.config, key)
    const headers: Record<string, string> = {}
    if (opts?.range) headers.Range = opts.range

    const signed = await this.client.sign(url, { method: 'GET', headers })
    let response: Response
    try {
      response = await fetch(signed)
    } catch (err) {
      throw new StorageAvailabilityError(key, `Upstream fetch failed: ${String(err)}`)
    }

    if (isNotFoundHttpStatus(response.status)) {
      throw new StorageNotFoundError(key)
    }
    if (!response.ok) {
      throw new StorageAvailabilityError(
        key,
        `Upstream returned ${response.status}`,
        response.status,
      )
    }

    return {
      status: response.status,
      headers: new Headers(response.headers),
      body: response.body,
    }
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    const url = buildObjectUrl(this.config, key)
    const signed = await this.client.sign(url, { method: 'HEAD' })
    let response: Response
    try {
      response = await fetch(signed)
    } catch {
      throw new StorageAvailabilityError(key, 'HEAD request failed')
    }

    if (response.status === 404) return null
    if (!response.ok) {
      throw new StorageAvailabilityError(key, `HEAD returned ${response.status}`, response.status)
    }

    const size = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
    const lastModifiedRaw = response.headers.get('last-modified')
    const result: HeadObjectResult = {
      key: normalizeKey(key),
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
    const url = buildObjectUrl(this.config, key)
    const headers: Record<string, string> = {}
    if (opts?.contentType) headers['Content-Type'] = opts.contentType
    if (opts?.cacheControl) headers['Cache-Control'] = opts.cacheControl

    const signed = await this.client.sign(url, { method: 'PUT', headers, body: body as BodyInit })
    let response: Response
    try {
      response = await fetch(signed)
    } catch (err) {
      throw new StorageAvailabilityError(key, `PUT failed: ${String(err)}`)
    }
    if (!response.ok) {
      throw new StorageAvailabilityError(key, `PUT returned ${response.status}`, response.status)
    }
  }

  async deleteObject(key: string): Promise<void> {
    const url = buildObjectUrl(this.config, key)
    const signed = await this.client.sign(url, { method: 'DELETE' })
    let response: Response
    try {
      response = await fetch(signed)
    } catch (err) {
      throw new StorageAvailabilityError(key, `DELETE failed: ${String(err)}`)
    }
    if (!response.ok && response.status !== 404) {
      throw new StorageAvailabilityError(key, `DELETE returned ${response.status}`, response.status)
    }
  }

  async listObjects(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = []
    let continuationToken: string | undefined
    do {
      const url = buildListUrl(this.config, prefix, continuationToken)
      const signed = await this.client.sign(url, { method: 'GET' })
      const response = await fetch(signed)
      if (!response.ok) {
        throw new StorageAvailabilityError(prefix, `LIST returned ${response.status}`, response.status)
      }
      const xml = await response.text()
      const page = parseListObjectsXml(xml)
      out.push(...page.objects)
      continuationToken = page.truncated ? page.nextToken : undefined
    } while (continuationToken)
    return out
  }
}
