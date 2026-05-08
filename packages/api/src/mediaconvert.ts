import { requireRole } from './auth.js'
import { ensureAdminSettingsTable } from './adminSettingsTable.js'

type CorsHeaders = Record<string, string>

const MEDIA_CONVERT_STATUSES = new Set([
  'uploaded',
  'queued',
  'transcoding',
  'packaging',
  'uploading',
  'completed',
  'failed',
])

const HD_NORMALIZED_MULTIPLIER = 1
const DEFAULT_HD_PRICE_PER_MINUTE_USD = 0.015
const DEFAULT_MAX_UPLOAD_MB = 512

function jsonResponse(data: unknown, status = 200, corsHeaders: CorsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

function getDb(env: any) {
  return env.DB || env.video_subscription_db
}

function envTrim(env: any, key: string, fallback = ''): string {
  const v = env?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}

function isMediaConvertEnabled(env: any): boolean {
  return envTrim(env, 'MEDIA_CONVERT_ENABLED', '0') === '1'
}

function getMediaConvertConfig(env: any) {
  const cfg = {
    enabled: isMediaConvertEnabled(env),
    region: envTrim(env, 'AWS_REGION'),
    accessKeyId: envTrim(env, 'AWS_ACCESS_KEY_ID'),
    secretAccessKey: envTrim(env, 'AWS_SECRET_ACCESS_KEY'),
    sessionToken: envTrim(env, 'AWS_SESSION_TOKEN'),
    endpoint: envTrim(env, 'MEDIA_CONVERT_ENDPOINT'),
    roleArn: envTrim(env, 'MEDIA_CONVERT_ROLE_ARN'),
    inputBucket: envTrim(env, 'MEDIA_CONVERT_INPUT_BUCKET'),
    outputBucket: envTrim(env, 'MEDIA_CONVERT_OUTPUT_BUCKET'),
    inputPrefix: envTrim(env, 'MEDIA_CONVERT_INPUT_PREFIX', 'mediaconvert-input'),
    outputPrefix: envTrim(env, 'MEDIA_CONVERT_OUTPUT_PREFIX', 'mediaconvert-output'),
    maxUploadMb: Number.parseInt(envTrim(env, 'MEDIA_CONVERT_MAX_UPLOAD_MB', String(DEFAULT_MAX_UPLOAD_MB)), 10) || DEFAULT_MAX_UPLOAD_MB,
    hdPricePerMinuteUsd: Number.parseFloat(envTrim(env, 'MEDIA_CONVERT_PRICE_HD_PER_MIN', String(DEFAULT_HD_PRICE_PER_MINUTE_USD))) || DEFAULT_HD_PRICE_PER_MINUTE_USD,
  }
  const required = [
    cfg.region, cfg.accessKeyId, cfg.secretAccessKey, cfg.endpoint,
    cfg.roleArn, cfg.inputBucket, cfg.outputBucket,
  ]
  const configured = required.every(Boolean)
  return { ...cfg, configured }
}

function hmacSha256Raw(key: BufferSource, message: string) {
  const enc = new TextEncoder()
  return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((k) => crypto.subtle.sign('HMAC', k, enc.encode(message)))
}

async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function getSignatureKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256Raw(new TextEncoder().encode(`AWS4${secret}`), date)
  const kRegion = await hmacSha256Raw(kDate, region)
  const kService = await hmacSha256Raw(kRegion, service)
  return hmacSha256Raw(kService, 'aws4_request')
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

async function createPresignedS3PutUrl({
  bucket,
  key,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  expiresSeconds = 900,
}: {
  bucket: string
  key: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  expiresSeconds?: number
}) {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const host = `${bucket}.s3.${region}.amazonaws.com`
  const canonicalUri = `/${key.split('/').map(encodeRfc3986).join('/')}`
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`

  const params = new URLSearchParams()
  params.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  params.set('X-Amz-Credential', `${accessKeyId}/${credentialScope}`)
  params.set('X-Amz-Date', amzDate)
  params.set('X-Amz-Expires', String(expiresSeconds))
  params.set('X-Amz-SignedHeaders', 'host')
  if (sessionToken) params.set('X-Amz-Security-Token', sessionToken)

  const canonicalQueryString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&')

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, 's3')
  const signature = toHex(await hmacSha256Raw(signingKey, stringToSign))
  params.set('X-Amz-Signature', signature)

  return `https://${host}${canonicalUri}?${params.toString()}`
}

async function awsSignedFetch({
  method,
  url,
  service,
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  payload = '',
  contentType,
}: {
  method: string
  url: string
  service: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  payload?: string | ArrayBuffer
  contentType?: string
}) {
  const endpoint = new URL(url)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = await sha256Hex(payload)

  const canonicalUri = endpoint.pathname || '/'
  const canonicalQueryString = endpoint.searchParams.toString()
  const canonicalHeadersBase: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  if (contentType) canonicalHeadersBase['content-type'] = contentType
  if (sessionToken) canonicalHeadersBase['x-amz-security-token'] = sessionToken

  const sortedHeaderNames = Object.keys(canonicalHeadersBase).sort()
  const canonicalHeaders = sortedHeaderNames
    .map((h) => `${h}:${canonicalHeadersBase[h]}`)
    .join('\n') + '\n'
  const signedHeaders = sortedHeaderNames.join(';')

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n')
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service)
  const signature = toHex(await hmacSha256Raw(signingKey, stringToSign))
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const headers = new Headers()
  headers.set('Authorization', authorization)
  headers.set('x-amz-content-sha256', payloadHash)
  headers.set('x-amz-date', amzDate)
  if (contentType) headers.set('Content-Type', contentType)
  if (sessionToken) headers.set('x-amz-security-token', sessionToken)

  return fetch(endpoint.toString(), {
    method: method.toUpperCase(),
    headers,
    body: typeof payload === 'string' ? payload : new Uint8Array(payload),
  })
}

function buildMediaConvertJobPayload({
  roleArn,
  inputUrl,
  destination,
}: {
  roleArn: string
  inputUrl: string
  destination: string
}) {
  return {
    Role: roleArn,
    Settings: {
      TimecodeConfig: { Source: 'ZEROBASED' },
      Inputs: [{ FileInput: inputUrl }],
      OutputGroups: [
        {
          Name: 'HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              SegmentLength: 6,
              MinSegmentLength: 0,
              Destination: destination,
              ManifestDurationFormat: 'INTEGER',
            },
          },
          Outputs: [
            {
              NameModifier: '_720p',
              ContainerSettings: { Container: 'M3U8' },
              VideoDescription: {
                Width: 1280,
                Height: 720,
                RespondToAfd: 'NONE',
                ScalingBehavior: 'DEFAULT',
                Sharpness: 50,
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    MaxBitrate: 3000000,
                    RateControlMode: 'QVBR',
                    SceneChangeDetect: 'TRANSITION_DETECTION',
                    FramerateControl: 'SPECIFIED',
                    FramerateNumerator: 30,
                    FramerateDenominator: 1,
                    CodecProfile: 'MAIN',
                    CodecLevel: 'AUTO',
                  },
                },
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: 'AAC',
                    AacSettings: {
                      Bitrate: 128000,
                      CodingMode: 'CODING_MODE_2_0',
                      SampleRate: 48000,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

function parseS3ListKeys(xml: string): string[] {
  const matches = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)]
  return matches.map((m) => m[1]).filter((key): key is string => typeof key === 'string' && key.length > 0)
}

function parseS3ListContinuation(xml: string): { isTruncated: boolean, nextToken: string | null } {
  const truncated = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/i)?.[1]?.toLowerCase() === 'true'
  const nextTokenRaw = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/i)?.[1] ?? null
  return { isTruncated: truncated, nextToken: nextTokenRaw ? nextTokenRaw : null }
}

async function listAllOutputKeys({
  cfg,
  sessionTokenArg,
  prefix,
}: {
  cfg: ReturnType<typeof getMediaConvertConfig>
  sessionTokenArg: Record<string, string>
  prefix: string
}): Promise<{ ok: true, keys: string[] } | { ok: false, error: string }> {
  const keys: string[] = []
  let continuationToken: string | null = null

  for (let page = 0; page < 1000; page += 1) {
    const params = new URLSearchParams()
    params.set('list-type', '2')
    params.set('prefix', prefix)
    if (continuationToken) params.set('continuation-token', continuationToken)
    const listUrl = `https://${cfg.outputBucket}.s3.${cfg.region}.amazonaws.com/?${params.toString()}`
    const listRes = await awsSignedFetch({
      method: 'GET',
      url: listUrl,
      service: 's3',
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      ...sessionTokenArg,
      payload: '',
    })
    if (!listRes.ok) {
      const detail = await listRes.text().catch(() => '')
      return { ok: false, error: `S3 list failed: ${detail.slice(0, 400)}` }
    }
    const xml = await listRes.text()
    keys.push(...parseS3ListKeys(xml))
    const { isTruncated, nextToken } = parseS3ListContinuation(xml)
    if (!isTruncated) break
    if (!nextToken) return { ok: false, error: 'S3 list failed: missing continuation token' }
    continuationToken = nextToken
  }

  return { ok: true, keys }
}

async function upsertVideoDraftRow(db: any, videoId: string, title: string, description: string | null, categoryId: string | null) {
  await db.prepare(`
    INSERT OR IGNORE INTO videos (id, title, description, publish_status, upload_date, full_duration, preview_duration, status, updated_at)
    VALUES (?, ?, ?, 'draft', CURRENT_TIMESTAMP, 0, 0, 'uploaded', CURRENT_TIMESTAMP)
  `).bind(videoId, title, description).run()

  await db.prepare(`
    UPDATE videos
      SET title = COALESCE(NULLIF(?, ''), title),
          description = ?,
          status = 'uploaded',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
  `).bind(title, description, videoId).run()

  if (categoryId) {
    await db.prepare(`
      INSERT INTO video_category_assignments (video_id, category_id, assigned_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(video_id) DO UPDATE SET category_id = excluded.category_id, assigned_at = CURRENT_TIMESTAMP
    `).bind(videoId, categoryId).run()
  }
}

function estimateUsage(durationSeconds: number, renditionCount: number, hdPricePerMinuteUsd: number) {
  const minutes = Math.max(0, durationSeconds) / 60
  const normalizedMinutes = minutes * renditionCount * HD_NORMALIZED_MULTIPLIER
  const estimatedCostUsd = normalizedMinutes * hdPricePerMinuteUsd
  return { normalizedMinutes, estimatedCostUsd }
}

export async function handleAdminMediaConvertUpload(request: Request, env: any, corsHeaders: CorsHeaders) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)

  const cfg = getMediaConvertConfig(env)
  if (!cfg.enabled) {
    return jsonResponse({ error: 'MediaConvert pipeline is disabled' }, 503, corsHeaders)
  }
  if (!cfg.configured) {
    return jsonResponse({ error: 'MediaConvert pipeline is not fully configured' }, 503, corsHeaders)
  }

  const bodyRaw = await request.json().catch(() => null)
  const body = (bodyRaw && typeof bodyRaw === 'object') ? bodyRaw as Record<string, unknown> : null
  if (!body) return jsonResponse({ error: 'Expected JSON body' }, 400, corsHeaders)

  const fileName = String(body.fileName || '').trim()
  const fileType = String(body.fileType || 'application/octet-stream').trim() || 'application/octet-stream'
  const fileSize = Number(body.fileSize || 0)
  if (!fileName) return jsonResponse({ error: 'fileName is required' }, 400, corsHeaders)
  if (!Number.isFinite(fileSize) || fileSize <= 0) return jsonResponse({ error: 'fileSize must be > 0' }, 400, corsHeaders)
  if (fileSize > cfg.maxUploadMb * 1024 * 1024) {
    return jsonResponse({ error: `file exceeds ${cfg.maxUploadMb}MB limit` }, 413, corsHeaders)
  }

  const title = String(body.title || 'Untitled upload').trim() || 'Untitled upload'
  const descriptionRaw = String(body.description || '').trim()
  const description = descriptionRaw || null
  const categoryIdRaw = String(body.categoryId || '').trim()
  const categoryId = categoryIdRaw || null
  const durationSecondsRaw = Number(body.durationSeconds || 0)
  const inputDurationSeconds = Number.isFinite(durationSecondsRaw) && durationSecondsRaw > 0
    ? Math.floor(durationSecondsRaw)
    : 0

  const videoId = crypto.randomUUID()
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const inputKey = `${cfg.inputPrefix.replace(/\/+$/, '')}/${videoId}/${safeName}`
  const outputPrefix = `${cfg.outputPrefix.replace(/\/+$/, '')}/${videoId}`
  const db = getDb(env)
  await ensureAdminSettingsTable(db)
  if (categoryId) {
    const category = await db.prepare(`SELECT id FROM video_categories WHERE id = ?`).bind(categoryId).first()
    if (!category) return jsonResponse({ error: 'Category not found', code: 'category_not_found' }, 404, corsHeaders)
  }

  await upsertVideoDraftRow(db, videoId, title, description, categoryId)

  const renditions = [{ name: '720p', width: 1280, height: 720, codec: 'h264' }]
  const usage = estimateUsage(inputDurationSeconds, renditions.length, cfg.hdPricePerMinuteUsd)
  const jobId = crypto.randomUUID()

  await db.prepare(`
    INSERT INTO media_convert_jobs (
      id, video_id, status, input_bucket, input_key, output_bucket, output_prefix, renditions_json, input_duration_seconds,
      normalized_minutes_est, cost_est_usd, created_at, updated_at
    )
    VALUES (?, ?, 'uploaded', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    jobId, videoId, cfg.inputBucket, inputKey, cfg.outputBucket, outputPrefix,
    JSON.stringify(renditions), inputDurationSeconds, usage.normalizedMinutes, usage.estimatedCostUsd,
  ).run()

  const presignedTokenArg = cfg.sessionToken ? { sessionToken: cfg.sessionToken } : {}
  const uploadUrl = await createPresignedS3PutUrl({
    bucket: cfg.inputBucket,
    key: inputKey,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    ...presignedTokenArg,
  })

  return jsonResponse({
    ok: true,
    videoId,
    job: {
      id: jobId,
      status: 'uploaded',
      inputDurationSeconds,
      normalizedMinutesEstimated: usage.normalizedMinutes,
      estimatedCostUsd: usage.estimatedCostUsd,
      renditions,
    },
    upload: {
      method: 'PUT',
      url: uploadUrl,
      contentType: fileType,
      inputKey,
      expiresInSeconds: 900,
    },
  }, 201, corsHeaders)
}

export async function handleAdminMediaConvertUploadComplete(request: Request, env: any, corsHeaders: CorsHeaders) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)

  const cfg = getMediaConvertConfig(env)
  if (!cfg.enabled || !cfg.configured) {
    return jsonResponse({ error: 'MediaConvert pipeline is not configured' }, 503, corsHeaders)
  }

  const bodyRaw = await request.json().catch(() => null)
  const body = (bodyRaw && typeof bodyRaw === 'object') ? bodyRaw as Record<string, unknown> : null
  const jobId = String(body?.jobId || '').trim()
  if (!jobId) return jsonResponse({ error: 'jobId is required' }, 400, corsHeaders)

  const db = getDb(env)
  const sessionTokenArg = cfg.sessionToken ? { sessionToken: cfg.sessionToken } : {}
  const job = await db.prepare(`
    SELECT id, video_id, input_key, output_prefix
    FROM media_convert_jobs
    WHERE id = ?
    LIMIT 1
  `).bind(jobId).first()
  if (!job) return jsonResponse({ error: 'Upload job not found' }, 404, corsHeaders)

  const mcBody = buildMediaConvertJobPayload({
    roleArn: cfg.roleArn,
    inputUrl: `s3://${cfg.inputBucket}/${job.input_key}`,
    destination: `s3://${cfg.outputBucket}/${job.output_prefix}/`,
  })

  const createRes = await awsSignedFetch({
    method: 'POST',
    url: `${cfg.endpoint.replace(/\/$/, '')}/2017-08-29/jobs`,
    service: 'mediaconvert',
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    ...sessionTokenArg,
    payload: JSON.stringify(mcBody),
    contentType: 'application/json',
  })
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => '')
    await db.batch([
      db.prepare(`UPDATE media_convert_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(detail.slice(0, 1000), jobId),
      db.prepare(`UPDATE videos SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(job.video_id),
    ])
    return jsonResponse({ error: 'Failed to create MediaConvert job', code: 'mediaconvert_create_failed' }, 502, corsHeaders)
  }

  const createPayload: any = await createRes.json().catch(() => ({}))
  const awsJobId = String(createPayload?.Job?.Id || '').trim()
  if (!awsJobId) {
    await db.batch([
      db.prepare(`UPDATE media_convert_jobs SET status = 'failed', error = 'MediaConvert response missing Job.Id', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(jobId),
      db.prepare(`UPDATE videos SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(job.video_id),
    ])
    return jsonResponse({ error: 'MediaConvert returned an invalid response' }, 502, corsHeaders)
  }

  await db.batch([
    db.prepare(`UPDATE media_convert_jobs SET aws_job_id = ?, status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(awsJobId, jobId),
    db.prepare(`UPDATE videos SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(job.video_id),
  ])

  return jsonResponse({ ok: true, jobId, awsJobId, status: 'queued' }, 200, corsHeaders)
}

export async function pollMediaConvertJobs(env: any) {
  const cfg = getMediaConvertConfig(env)
  if (!cfg.enabled || !cfg.configured) return
  const db = getDb(env)
  const sessionTokenArg = cfg.sessionToken ? { sessionToken: cfg.sessionToken } : {}

  const pending = await db.prepare(`
    SELECT id, video_id, aws_job_id, input_duration_seconds, output_prefix
    FROM media_convert_jobs
    WHERE status IN ('uploaded', 'queued', 'transcoding', 'packaging', 'uploading')
    ORDER BY created_at ASC
    LIMIT 20
  `).all()

  for (const row of pending.results || []) {
    const localJobId = row.id as string
    const videoId = row.video_id as string
    const awsJobId = row.aws_job_id as string | null
    if (!awsJobId) continue

    const jobRes = await awsSignedFetch({
      method: 'GET',
      url: `${cfg.endpoint.replace(/\/$/, '')}/2017-08-29/jobs/${encodeURIComponent(awsJobId)}`,
      service: 'mediaconvert',
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      ...sessionTokenArg,
      payload: '',
    })
    if (!jobRes.ok) {
      await db.prepare(`
        UPDATE media_convert_jobs
        SET last_polled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(localJobId).run()
      continue
    }
    const data: any = await jobRes.json().catch(() => ({}))
    const statusRaw = String(data?.Job?.Status || '').toUpperCase()
    const progress = Number(data?.Job?.JobPercentComplete || 0)

    if (statusRaw === 'SUBMITTED' || statusRaw === 'INPUT_INFORMATION') {
      await db.batch([
        db.prepare(`UPDATE media_convert_jobs SET status = 'queued', last_polled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(localJobId),
        db.prepare(`UPDATE videos SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(videoId),
      ])
      continue
    }

    if (statusRaw === 'PROGRESSING') {
      const mapped = progress >= 95 ? 'packaging' : 'transcoding'
      await db.batch([
        db.prepare(`UPDATE media_convert_jobs SET status = ?, last_polled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(mapped, localJobId),
        db.prepare(`UPDATE videos SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(mapped, videoId),
      ])
      continue
    }

    if (statusRaw === 'ERROR' || statusRaw === 'CANCELED') {
      const detail = String(data?.Job?.ErrorMessage || statusRaw)
      await db.batch([
        db.prepare(`UPDATE media_convert_jobs SET status = 'failed', error = ?, last_polled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(detail.slice(0, 1000), localJobId),
        db.prepare(`UPDATE videos SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(videoId),
      ])
      continue
    }

    if (statusRaw !== 'COMPLETE') continue

    await db.batch([
      db.prepare(`UPDATE media_convert_jobs SET status = 'uploading', last_polled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(localJobId),
      db.prepare(`UPDATE videos SET status = 'uploading', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(videoId),
    ])

    const prefix = `${row.output_prefix}`.replace(/\/+$/, '') + '/'
    const listResult = await listAllOutputKeys({ cfg, sessionTokenArg, prefix })
    if (!listResult.ok) {
      await db.batch([
        db.prepare(`UPDATE media_convert_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(listResult.error, localJobId),
        db.prepare(`UPDATE videos SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(videoId),
      ])
      continue
    }
    const keys = listResult.keys
    const videoPrefix = `videos/${videoId}/`
    if (!env.BUCKET) {
      await db.batch([
        db.prepare(`UPDATE media_convert_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind('missing R2 BUCKET', localJobId),
        db.prepare(`UPDATE videos SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(videoId),
      ])
      continue
    }

    for (const sourceKey of keys) {
      const rel = sourceKey.startsWith(prefix) ? sourceKey.slice(prefix.length) : sourceKey
      const r2Key = `${videoPrefix}${rel}`
      const getUrl = `https://${cfg.outputBucket}.s3.${cfg.region}.amazonaws.com/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`
      const getRes = await awsSignedFetch({
        method: 'GET',
        url: getUrl,
        service: 's3',
        region: cfg.region,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        ...sessionTokenArg,
        payload: '',
      })
      if (!getRes.ok) {
        const detail = await getRes.text().catch(() => '')
        await db.batch([
          db.prepare(`UPDATE media_convert_jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(`S3 get failed: ${detail.slice(0, 400)}`, localJobId),
          db.prepare(`UPDATE videos SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(videoId),
        ])
        break
      }
      await env.BUCKET.put(r2Key, getRes.body, {
        httpMetadata: { contentType: getRes.headers.get('content-type') || undefined },
      })
    }

    const current = await db.prepare(`SELECT status FROM media_convert_jobs WHERE id = ?`).bind(localJobId).first()
    if (current?.status === 'failed') continue

    const inputDurationSeconds = Number(row.input_duration_seconds || 0)
    const previewSeconds = inputDurationSeconds > 0 ? Math.min(180, inputDurationSeconds) : 0
    await db.batch([
      db.prepare(`
        UPDATE media_convert_jobs
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP, last_polled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(localJobId),
      db.prepare(`
        UPDATE videos
        SET status = 'processed',
            full_duration = CASE WHEN ? > 0 THEN ? ELSE full_duration END,
            preview_duration = CASE WHEN ? > 0 THEN ? ELSE preview_duration END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(inputDurationSeconds, inputDurationSeconds, previewSeconds, previewSeconds, videoId),
    ])
  }
}

export async function handleAdminMediaConvertConfig(request: Request, env: any, corsHeaders: CorsHeaders) {
  try {
    await requireRole(request, env, 'admin', 'super_admin')
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders)
  const cfg = getMediaConvertConfig(env)
  const db = getDb(env)
  await ensureAdminSettingsTable(db)
  const row = await db.prepare(`SELECT value FROM admin_settings WHERE key = ? LIMIT 1`).bind('mediaconvert_hd_price_per_min').first()
  const price = Number.parseFloat(String(row?.value || cfg.hdPricePerMinuteUsd)) || cfg.hdPricePerMinuteUsd
  return jsonResponse({
    enabled: cfg.enabled,
    configured: cfg.configured,
    inputBucket: cfg.inputBucket,
    outputBucket: cfg.outputBucket,
    inputPrefix: cfg.inputPrefix,
    outputPrefix: cfg.outputPrefix,
    renditions: [{ name: '720p', codec: 'h264', fpsCap: 30 }],
    pricing: {
      hdPerMinuteUsd: price,
      normalizedMultiplierHd: HD_NORMALIZED_MULTIPLIER,
    },
    supportedFutureTargets: ['480p', '720p', '1080p', '4k', 'alternate-codecs'],
  }, 200, corsHeaders)
}

export function enrichVideosWithMediaConvert(videos: any[]) {
  return (videos || []).map((video) => {
    const ingestStatus = typeof video?.media_convert_status === 'string' && MEDIA_CONVERT_STATUSES.has(video.media_convert_status)
      ? video.media_convert_status
      : null
    return {
      ...video,
      ingest_status: ingestStatus,
      media_convert_usage: ingestStatus
        ? {
            input_duration_seconds: Number(video?.media_convert_input_duration_seconds || 0),
            normalized_minutes_est: Number(video?.media_convert_normalized_minutes_est || 0),
            estimated_cost_usd: Number(video?.media_convert_cost_est_usd || 0),
          }
        : null,
    }
  })
}
