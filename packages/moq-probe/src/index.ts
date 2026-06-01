#!/usr/bin/env node
import * as Moq from '@moq/net'

const MOQ_PRIORITY = {
  catalog: 100,
  audio: 80,
  video: 60,
} as const

type CatalogFormat = 'auto' | 'hang' | 'msf'
type OutputFormat = 'markdown' | 'json'
type MediaKind = 'video' | 'audio' | 'preview' | 'location' | 'unknown'

interface ProbeOptions {
  endpoint: string
  broadcast: string
  groups: number
  framesPerGroup: number
  catalogFormat: CatalogFormat
  output: OutputFormat
  timeoutMs: number
  trackFilters: string[]
  websocketEnabled: boolean
  websocketUrl?: string
}

interface RuntimeReport {
  nodeVersion: string
  platform: string
  hasNativeWebTransport: boolean
  hasNativeWebSocket: boolean
  moqNetImportOk: boolean
  requiredQuicApisAvailable: boolean
  canAttemptConnection: boolean
  transportFindings: string[]
  recommendedRuntime: string
}

interface TrackDescriptor {
  name: string
  mediaKind: MediaKind
  codec?: string
  container?: unknown
  timescale?: number
  trackId?: number
  metadata: Record<string, unknown>
}

interface CatalogReport {
  format: 'hang' | 'msf' | 'none'
  trackName: string | null
  rawBytes?: number
  error?: string
  tracks: TrackDescriptor[]
  rawCatalog?: unknown
}

interface PayloadInspection {
  trackName: string
  trackAlias: null
  subgroupId: null
  groupId: number
  frameId: number | null
  payloadLength: number
  firstBytesHex: string
  firstBytesAscii: string
  signatures: string[]
  isoBmffBoxes: Array<{ offset: number; type: string; size: number | 'largesize' | 'eof' | 'invalid' }>
  cmaf: {
    likely: boolean
    decodeTimestampUs?: number
    decodeTimestampError?: string
  }
  elementaryStreamHints: string[]
  timestampMethods: string[]
}

interface TrackProbeReport {
  track: TrackDescriptor
  subscribed: boolean
  error?: string
  groupsObserved: number
  framesObserved: number
  inspections: PayloadInspection[]
  groupMappingEvidence: string[]
  groupMappingConclusion: string
}

interface ProbeReport {
  generatedAt: string
  endpoint: string
  broadcast: string
  relay: {
    origin: string
    protocol: string
    host: string
  }
  runtime: RuntimeReport
  connection?: {
    ok: boolean
    protocolVersion?: string
    url?: string
    transportNotes: string[]
    error?: string
  }
  catalog: CatalogReport
  tracks: TrackProbeReport[]
  timestampStrategy: string[]
  payloadFormat: string
  recommendedRecorderDesign: string
  decisionMatrix: Record<string, string>
  limitations: string[]
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

function parseArgs(argv: string[]): ProbeOptions {
  const options: ProbeOptions = {
    endpoint: process.env.MOQ_ENDPOINT ?? '',
    broadcast: process.env.MOQ_BROADCAST ?? '',
    groups: Number.parseInt(process.env.MOQ_PROBE_GROUPS ?? '3', 10),
    framesPerGroup: Number.parseInt(process.env.MOQ_PROBE_FRAMES_PER_GROUP ?? '4', 10),
    catalogFormat: parseCatalogFormatOrDefault(process.env.MOQ_CATALOG_FORMAT),
    output: 'markdown',
    timeoutMs: Number.parseInt(process.env.MOQ_PROBE_TIMEOUT_MS ?? '10000', 10),
    trackFilters: [],
    websocketEnabled: process.env.MOQ_PROBE_DISABLE_WEBSOCKET !== '1',
    websocketUrl: process.env.MOQ_WEBSOCKET_URL,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }

    if (arg === '--endpoint') options.endpoint = next()
    else if (arg === '--broadcast') options.broadcast = next()
    else if (arg === '--groups') options.groups = Number.parseInt(next(), 10)
    else if (arg === '--frames-per-group') options.framesPerGroup = Number.parseInt(next(), 10)
    else if (arg === '--catalog-format') options.catalogFormat = parseCatalogFormat(next())
    else if (arg === '--timeout-ms') options.timeoutMs = Number.parseInt(next(), 10)
    else if (arg === '--track') options.trackFilters.push(next())
    else if (arg === '--websocket-url') options.websocketUrl = next()
    else if (arg === '--disable-websocket') options.websocketEnabled = false
    else if (arg === '--json') options.output = 'json'
    else if (arg === '--markdown') options.output = 'markdown'
    else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(options.groups) || options.groups < 1) options.groups = 3
  if (!Number.isFinite(options.framesPerGroup) || options.framesPerGroup < 1) options.framesPerGroup = 4
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) options.timeoutMs = 10000
  if (!options.endpoint || !options.broadcast) {
    printUsage()
    throw new Error('Both --endpoint and --broadcast are required, or set MOQ_ENDPOINT and MOQ_BROADCAST.')
  }
  new URL(options.endpoint)
  if (options.websocketUrl) new URL(options.websocketUrl)
  return options
}

function parseCatalogFormat(value: string): CatalogFormat {
  if (value === 'auto' || value === 'hang' || value === 'msf') return value
  throw new Error('--catalog-format must be one of: auto, hang, msf')
}

function parseCatalogFormatOrDefault(value: string | undefined): CatalogFormat {
  if (value === 'auto' || value === 'hang' || value === 'msf') return value
  return 'auto'
}

function printUsage(): void {
  process.stderr.write(`MoQ Recorder Probe

Usage:
  npm run probe --workspace=@vmp/moq-probe -- \\
    --endpoint https://cdn.moq.dev/anon \\
    --broadcast obstesting123

Options:
  --endpoint <url>            MoQ relay endpoint. Env: MOQ_ENDPOINT
  --broadcast <name>          Broadcast path/name. Env: MOQ_BROADCAST
  --groups <n>                Groups to inspect per track. Default: 3
  --frames-per-group <n>      Frames/objects to inspect per group. Default: 4
  --catalog-format <format>   auto, hang, or msf. Default: auto
  --track <name>              Limit to a track. Repeatable.
  --timeout-ms <n>            Per operation timeout. Default: 10000
  --websocket-url <url>       Optional qmux/WebSocket fallback URL.
  --disable-websocket         Disable @moq/net WebSocket fallback.
  --json                      Emit JSON instead of Markdown.
`)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function runtimeReport(): RuntimeReport {
  const globals = globalThis as Record<string, unknown>
  const hasNativeWebTransport = typeof globals.WebTransport === 'function'
  const hasNativeWebSocket = typeof globals.WebSocket === 'function'
  const transportFindings = [
    hasNativeWebTransport
      ? 'globalThis.WebTransport is available.'
      : 'globalThis.WebTransport is not available in this Node runtime; native QUIC/WebTransport cannot be used directly.',
    hasNativeWebSocket
      ? '@moq/net can attempt its qmux/WebSocket fallback if the relay exposes one.'
      : 'globalThis.WebSocket is not available; @moq/net cannot use its WebSocket fallback without a polyfill.',
  ]
  return {
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    hasNativeWebTransport,
    hasNativeWebSocket,
    moqNetImportOk: true,
    requiredQuicApisAvailable: hasNativeWebTransport,
    canAttemptConnection: hasNativeWebTransport || hasNativeWebSocket,
    transportFindings,
    recommendedRuntime: hasNativeWebTransport
      ? 'Node can attempt native WebTransport with @moq/net.'
      : hasNativeWebSocket
        ? 'Node can run this probe only when the MoQ relay supports @moq/net qmux/WebSocket fallback. For true MoQ over QUIC, use a runtime with WebTransport support or a Rust/Go QUIC implementation.'
        : 'Use a runtime with WebTransport support, or implement the probe in Rust/Go with QUIC/WebTransport support.',
  }
}

function connectionProps(options: ProbeOptions): Moq.Connection.ConnectProps {
  return {
    websocket: {
      enabled: options.websocketEnabled,
      ...(options.websocketUrl ? { url: new URL(options.websocketUrl) } : {}),
      delay: 0,
    },
  }
}

async function readCatalogFrame(
  broadcast: Moq.Broadcast,
  trackName: string,
  timeoutMs: number,
): Promise<Uint8Array | undefined> {
  const track = broadcast.subscribe(trackName, MOQ_PRIORITY.catalog)
  try {
    return await withTimeout(track.readFrame(), timeoutMs, `catalog track ${trackName}`)
  } finally {
    track.close()
  }
}

async function discoverCatalog(
  broadcast: Moq.Broadcast,
  options: ProbeOptions,
): Promise<CatalogReport> {
  const errors: string[] = []

  if (options.catalogFormat === 'auto' || options.catalogFormat === 'hang') {
    try {
      const raw = await readCatalogFrame(broadcast, 'catalog.json', options.timeoutMs)
      if (raw) {
        const decoded = decodeJsonCatalog(raw)
        return {
          format: 'hang',
          trackName: 'catalog.json',
          rawBytes: raw.byteLength,
          tracks: normalizeHangTracks(decoded),
          rawCatalog: decoded,
        }
      }
    } catch (error) {
      errors.push(`HANG catalog.json: ${formatError(error)}`)
    }
  }

  if (options.catalogFormat === 'auto' || options.catalogFormat === 'msf') {
    try {
      const raw = await readCatalogFrame(broadcast, 'catalog', options.timeoutMs)
      if (raw) {
        const decoded = decodeJsonCatalog(raw)
        return {
          format: 'msf',
          trackName: 'catalog',
          rawBytes: raw.byteLength,
          tracks: normalizeMsfTracks(decoded),
          rawCatalog: decoded,
        }
      }
    } catch (error) {
      errors.push(`MSF catalog: ${formatError(error)}`)
    }
  }

  return {
    format: 'none',
    trackName: null,
    error: errors.join('; '),
    tracks: [],
  }
}

function decodeJsonCatalog(raw: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(raw))
}

function normalizeHangTracks(root: unknown): TrackDescriptor[] {
  const tracks: TrackDescriptor[] = []
  const value = root as {
    video?: { renditions?: Record<string, Record<string, unknown>> }
    audio?: { renditions?: Record<string, Record<string, unknown>> }
    preview?: { name?: string }
    location?: { track?: { name?: string } }
  }

  for (const [name, config] of Object.entries(value.video?.renditions ?? {})) {
    tracks.push(trackFromConfig(name, 'video', config))
  }
  for (const [name, config] of Object.entries(value.audio?.renditions ?? {})) {
    tracks.push(trackFromConfig(name, 'audio', config))
  }
  if (value.preview?.name) {
    tracks.push({
      name: value.preview.name,
      mediaKind: 'preview',
      metadata: { source: 'hang.preview' },
    })
  }
  if (value.location?.track?.name) {
    tracks.push({
      name: value.location.track.name,
      mediaKind: 'location',
      metadata: { source: 'hang.location' },
    })
  }
  return tracks
}

function trackFromConfig(name: string, mediaKind: MediaKind, config: Record<string, unknown>): TrackDescriptor {
  const container = config.container as Record<string, unknown> | undefined
  return {
    name,
    mediaKind,
    codec: typeof config.codec === 'string' ? config.codec : undefined,
    container,
    timescale: typeof container?.timescale === 'number' ? container.timescale : undefined,
    trackId: typeof container?.trackId === 'number' ? container.trackId : undefined,
    metadata: { ...config },
  }
}

function normalizeMsfTracks(catalog: unknown): TrackDescriptor[] {
  const value = catalog as { tracks?: Array<Record<string, unknown>> }
  return (value.tracks ?? [])
    .filter((track) => typeof track.name === 'string')
    .map((track) => ({
      name: String(track.name),
      mediaKind: parseMediaKind(track.role),
      codec: typeof track.codec === 'string' ? track.codec : undefined,
      container: { kind: track.packaging },
      metadata: { ...track },
    }))
}

function parseMediaKind(value: unknown): MediaKind {
  if (value === 'video' || value === 'audio' || value === 'preview' || value === 'location') return value
  return 'unknown'
}

async function inspectTrack(
  broadcast: Moq.Broadcast,
  track: TrackDescriptor,
  options: ProbeOptions,
): Promise<TrackProbeReport> {
  const subscribed = broadcast.subscribe(track.name, track.mediaKind === 'audio' ? MOQ_PRIORITY.audio : MOQ_PRIORITY.video)
  const inspections: PayloadInspection[] = []
  const groupFrameCounts: number[] = []
  let groupsObserved = 0
  let framesObserved = 0

  try {
    for (let groupIndex = 0; groupIndex < options.groups; groupIndex += 1) {
      const group = await withTimeout(subscribed.recvGroup(), options.timeoutMs, `track ${track.name} group ${groupIndex}`)
      if (!group) break
      groupsObserved += 1
      let framesInGroup = 0

      try {
        for (let frameIndex = 0; frameIndex < options.framesPerGroup; frameIndex += 1) {
          const frame = await withTimeout(group.readFrameSequence(), options.timeoutMs, `track ${track.name} group ${group.sequence} frame ${frameIndex}`)
          if (!frame) break
          framesInGroup += 1
          framesObserved += 1
          inspections.push(inspectPayload(track, group.sequence, frame.sequence, frame.data))
        }
      } finally {
        group.close()
      }
      groupFrameCounts.push(framesInGroup)
    }

    const groupMapping = inferGroupMapping(inspections, groupFrameCounts)
    return {
      track,
      subscribed: true,
      groupsObserved,
      framesObserved,
      inspections,
      groupMappingEvidence: groupMapping.evidence,
      groupMappingConclusion: groupMapping.conclusion,
    }
  } catch (error) {
    const groupMapping = inferGroupMapping(inspections, groupFrameCounts)
    return {
      track,
      subscribed: true,
      error: formatError(error),
      groupsObserved,
      framesObserved,
      inspections,
      groupMappingEvidence: groupMapping.evidence,
      groupMappingConclusion: groupMapping.conclusion,
    }
  } finally {
    subscribed.close()
  }
}

function inspectPayload(track: TrackDescriptor, groupId: number, frameId: number | null, payload: Uint8Array): PayloadInspection {
  const boxes = parseIsoBmffBoxes(payload)
  const signatures = findSignatures(payload, boxes)
  const elementaryStreamHints = findElementaryStreamHints(payload)
  const timestampMethods: string[] = []
  let decodeTimestampUs: number | undefined
  let decodeTimestampError: string | undefined

  if (track.timescale && signatures.includes('moof')) {
    try {
      decodeTimestampUs = decodeCmafTimestampUs(payload, track.timescale)
      timestampMethods.push(`CMAF decode timestamp via @moq/hang/container/cmaf decodeTimestamp(payload, ${track.timescale})`)
    } catch (error) {
      decodeTimestampError = formatError(error)
      timestampMethods.push(`CMAF timestamp attempted with timescale ${track.timescale} but failed`)
    }
  }

  const containerKind = containerKindOf(track)
  if (containerKind === 'legacy') {
    try {
      const [timestamp] = Moq.Varint.decode(payload)
      timestampMethods.push(`HANG legacy timestamp from leading MoQ varint: ${timestamp} microseconds`)
    } catch (error) {
      timestampMethods.push(`HANG legacy leading varint timestamp unavailable: ${formatError(error)}`)
    }
  }
  if (track.timescale || track.trackId) {
    timestampMethods.push(`Catalog metadata exposes CMAF trackId=${track.trackId ?? 'unknown'} timescale=${track.timescale ?? 'unknown'}`)
  }
  timestampMethods.push('Frame metadata exposed by @moq/net contains group/frame sequence only, not media timestamp')
  timestampMethods.push('Track alias and subgroup id are not exposed by the high-level @moq/net Track API')

  return {
    trackName: track.name,
    trackAlias: null,
    subgroupId: null,
    groupId,
    frameId,
    payloadLength: payload.byteLength,
    firstBytesHex: toHex(payload.subarray(0, 32)),
    firstBytesAscii: toAscii(payload.subarray(0, 32)),
    signatures,
    isoBmffBoxes: boxes,
    cmaf: {
      likely: signatures.includes('moof') && signatures.includes('mdat'),
      decodeTimestampUs,
      decodeTimestampError,
    },
    elementaryStreamHints,
    timestampMethods,
  }
}

function containerKindOf(track: TrackDescriptor): string | undefined {
  const container = track.container as { kind?: unknown } | undefined
  return typeof container?.kind === 'string' ? container.kind : undefined
}

function parseIsoBmffBoxes(payload: Uint8Array): PayloadInspection['isoBmffBoxes'] {
  const boxes: PayloadInspection['isoBmffBoxes'] = []
  let offset = 0
  while (offset + 8 <= payload.byteLength && boxes.length < 12) {
    const size = readUint32(payload, offset)
    const type = toAscii(payload.subarray(offset + 4, offset + 8))
    if (!isBoxType(type)) break
    if (size === 1) {
      boxes.push({ offset, type, size: 'largesize' })
      break
    }
    if (size === 0) {
      boxes.push({ offset, type, size: 'eof' })
      break
    }
    if (size < 8 || offset + size > payload.byteLength) {
      boxes.push({ offset, type, size: 'invalid' })
      break
    }
    boxes.push({ offset, type, size })
    offset += size
  }
  return boxes
}

function decodeCmafTimestampUs(payload: Uint8Array, timescale: number): number {
  if (!Number.isFinite(timescale) || timescale <= 0) {
    throw new Error(`invalid CMAF timescale: ${timescale}`)
  }
  const baseMediaDecodeTime = findTfdtBaseMediaDecodeTime(payload, 0, payload.byteLength, 0)
  if (baseMediaDecodeTime == null) {
    throw new Error('tfdt baseMediaDecodeTime box not found')
  }
  return Math.round((baseMediaDecodeTime / timescale) * 1_000_000)
}

function findTfdtBaseMediaDecodeTime(payload: Uint8Array, start: number, end: number, depth: number): number | null {
  if (depth > 6) return null
  let offset = start
  while (offset + 8 <= end) {
    const size = readUint32(payload, offset)
    const type = toAscii(payload.subarray(offset + 4, offset + 8))
    if (!isBoxType(type)) return null
    if (size < 8 || offset + size > end) return null
    const boxEnd = offset + size
    if (type === 'tfdt') {
      if (offset + 16 > boxEnd) throw new Error('tfdt box too short')
      const version = payload[offset + 8] ?? 0
      if (version === 1) {
        if (offset + 20 > boxEnd) throw new Error('tfdt version 1 box too short')
        const high = readUint32(payload, offset + 12)
        const low = readUint32(payload, offset + 16)
        return high * 2 ** 32 + low
      }
      return readUint32(payload, offset + 12)
    }
    if (type === 'moof' || type === 'traf' || type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
      const nested = findTfdtBaseMediaDecodeTime(payload, offset + 8, boxEnd, depth + 1)
      if (nested != null) return nested
    }
    offset = boxEnd
  }
  return null
}

function readUint32(payload: Uint8Array, offset: number): number {
  return (((payload[offset] ?? 0) << 24)
    | ((payload[offset + 1] ?? 0) << 16)
    | ((payload[offset + 2] ?? 0) << 8)
    | (payload[offset + 3] ?? 0)) >>> 0
}

function isBoxType(value: string): boolean {
  return /^[a-zA-Z0-9 ]{4}$/.test(value)
}

function findSignatures(payload: Uint8Array, boxes: PayloadInspection['isoBmffBoxes']): string[] {
  const signatures = new Set<string>()
  for (const box of boxes) {
    if (typeof box.type === 'string') signatures.add(box.type)
  }
  for (const sig of ['ftyp', 'moov', 'moof', 'mdat', 'styp']) {
    if (indexOfAscii(payload, sig) >= 0) signatures.add(sig)
  }
  if (boxes.length > 0) signatures.add('iso-bmff')
  return Array.from(signatures)
}

function findElementaryStreamHints(payload: Uint8Array): string[] {
  const hints: string[] = []
  if (
    (payload[0] === 0x00 && payload[1] === 0x00 && payload[2] === 0x01)
    || (payload[0] === 0x00 && payload[1] === 0x00 && payload[2] === 0x00 && payload[3] === 0x01)
  ) {
    hints.push('Annex-B NAL start code')
  }
  if (payload[0] === 0xff && ((payload[1] ?? 0) & 0xf0) === 0xf0) {
    hints.push('AAC ADTS sync word')
  }
  if (toAscii(payload.subarray(0, 4)) === 'OggS' || indexOfAscii(payload, 'OpusHead') >= 0) {
    hints.push('Ogg/Opus signature')
  }
  if (payload[0] === 0x1a && payload[1] === 0x45 && payload[2] === 0xdf && payload[3] === 0xa3) {
    hints.push('EBML/WebM signature')
  }
  if (hints.length === 0) hints.push('No elementary-stream signature detected in first bytes')
  return hints
}

function indexOfAscii(payload: Uint8Array, needle: string): number {
  const bytes = new TextEncoder().encode(needle)
  outer: for (let i = 0; i <= payload.byteLength - bytes.byteLength; i += 1) {
    for (let j = 0; j < bytes.byteLength; j += 1) {
      if (payload[i + j] !== bytes[j]) continue outer
    }
    return i
  }
  return -1
}

function inferGroupMapping(inspections: PayloadInspection[], groupFrameCounts: number[]): { evidence: string[]; conclusion: string } {
  const evidence = [
    `groups observed: ${groupFrameCounts.length}`,
    `frames per observed group: ${groupFrameCounts.join(', ') || 'none'}`,
  ]
  const cmafFrames = inspections.filter((item) => item.cmaf.likely).length
  const totalFrames = inspections.length
  evidence.push(`CMAF-like frames: ${cmafFrames}/${totalFrames}`)

  if (totalFrames === 0) {
    return { evidence, conclusion: 'No payloads observed; group-to-fragment mapping is unknown.' }
  }
  if (cmafFrames === totalFrames && groupFrameCounts.every((count) => count === 1)) {
    return { evidence, conclusion: 'Evidence supports one MoQ group == one CMAF fragment.' }
  }
  if (cmafFrames === totalFrames && groupFrameCounts.some((count) => count > 1)) {
    return { evidence, conclusion: 'Evidence supports one MoQ group containing multiple CMAF fragments.' }
  }
  if (cmafFrames > 0) {
    return { evidence, conclusion: 'Mixed evidence: some payloads are CMAF-like, but groups are not clean one-fragment boundaries.' }
  }
  return { evidence, conclusion: 'Observed payloads are not CMAF fragments; groups do not currently map to CMAF fragment boundaries.' }
}

function summarizeTimestampStrategy(catalog: CatalogReport, tracks: TrackProbeReport[]): string[] {
  const lines: string[] = []
  if (catalog.tracks.some((track) => track.timescale || track.trackId)) {
    lines.push('Catalog exposes CMAF timing metadata: trackId and/or timescale.')
  }
  if (tracks.some((track) => track.inspections.some((inspection) => inspection.cmaf.decodeTimestampUs !== undefined))) {
    lines.push('At least one CMAF decode timestamp was extracted with @moq/hang/container/cmaf decodeTimestamp.')
  }
  if (tracks.some((track) => track.inspections.some((inspection) => inspection.timestampMethods.some((method) => method.startsWith('HANG legacy timestamp'))))) {
    lines.push('At least one legacy HANG timestamp was extracted from a leading MoQ varint.')
  }
  lines.push('@moq/net high-level frame metadata exposes group/frame sequence numbers, not media timestamps.')
  lines.push('Track alias/subgroup/object headers are internal to @moq/net and not available from Track/Group reads.')
  return lines
}

function summarizePayloadFormat(tracks: TrackProbeReport[]): string {
  const inspections = tracks.flatMap((track) => track.inspections)
  if (inspections.length === 0) return 'unknown: no media payloads observed'
  const cmaf = inspections.filter((inspection) => inspection.cmaf.likely).length
  const annexB = inspections.filter((inspection) => inspection.elementaryStreamHints.includes('Annex-B NAL start code')).length
  const aac = inspections.filter((inspection) => inspection.elementaryStreamHints.includes('AAC ADTS sync word')).length
  if (cmaf === inspections.length) return 'CMAF/fMP4 fragments'
  if (cmaf > 0) return 'mixed payloads with some CMAF/fMP4 fragments'
  if (annexB > 0 || aac > 0) return 'raw elementary stream payloads'
  return 'custom or opaque payload format'
}

function recommendRecorder(payloadFormat: string): { recommendation: string; matrix: Record<string, string> } {
  const matrix = {
    'payloads are already CMAF': 'Persist init segments and moof+mdat fragments almost verbatim to R2; generate HLS manifests from segment metadata.',
    'payloads are raw elementary streams': 'Insert a packaging layer before R2, using ffmpeg/shaka-packager or an in-process CMAF muxer.',
    'payload format is custom': 'Build a reconstruction layer from catalog + object semantics before choosing R2 media layout.',
  }
  if (payloadFormat.includes('CMAF/fMP4')) {
    return { recommendation: matrix['payloads are already CMAF'], matrix }
  }
  if (payloadFormat.includes('elementary')) {
    return { recommendation: matrix['payloads are raw elementary streams'], matrix }
  }
  return { recommendation: matrix['payload format is custom'], matrix }
}

async function runProbe(options: ProbeOptions): Promise<ProbeReport> {
  const runtime = runtimeReport()
  const endpoint = new URL(options.endpoint)
  const report: ProbeReport = {
    generatedAt: new Date().toISOString(),
    endpoint: options.endpoint,
    broadcast: options.broadcast,
    relay: {
      origin: endpoint.origin,
      protocol: endpoint.protocol,
      host: endpoint.host,
    },
    runtime,
    catalog: { format: 'none', trackName: null, tracks: [] },
    tracks: [],
    timestampStrategy: [],
    payloadFormat: 'unknown',
    recommendedRecorderDesign: 'unknown',
    decisionMatrix: {},
    limitations: [
      'This is a probe only: it does not record, upload to R2, or generate manifests.',
      'High-level @moq/net Track/Group APIs do not expose track alias or subgroup id.',
      'If Node uses WebSocket fallback, results validate payload format but not native QUIC/WebTransport behavior.',
    ],
  }

  let connection: Moq.Connection.Established | undefined
  try {
    connection = await withTimeout(
      Moq.Connection.connect(endpoint, connectionProps(options)),
      options.timeoutMs,
      'MoQ connection',
    )
    report.connection = {
      ok: true,
      protocolVersion: connection.version,
      url: connection.url.toString(),
      transportNotes: runtime.transportFindings,
    }

    const broadcast = connection.consume(Moq.Path.from(options.broadcast))
    report.catalog = await discoverCatalog(broadcast, options)

    const tracksToProbe = selectTracks(report.catalog.tracks, options.trackFilters)
    report.tracks = await Promise.all(tracksToProbe.map((track) => inspectTrack(broadcast, track, options)))
    report.timestampStrategy = summarizeTimestampStrategy(report.catalog, report.tracks)
    report.payloadFormat = summarizePayloadFormat(report.tracks)
    const recorder = recommendRecorder(report.payloadFormat)
    report.recommendedRecorderDesign = recorder.recommendation
    report.decisionMatrix = recorder.matrix
    return report
  } catch (error) {
    report.connection = {
      ok: false,
      error: formatError(error),
      transportNotes: runtime.transportFindings,
    }
    report.timestampStrategy = summarizeTimestampStrategy(report.catalog, report.tracks)
    const recorder = recommendRecorder(report.payloadFormat)
    report.recommendedRecorderDesign = recorder.recommendation
    report.decisionMatrix = recorder.matrix
    return report
  } finally {
    connection?.close()
  }
}

function selectTracks(tracks: TrackDescriptor[], filters: string[]): TrackDescriptor[] {
  if (filters.length === 0) return tracks
  const wanted = new Set(filters)
  return tracks.filter((track) => wanted.has(track.name))
}

function toHex(payload: Uint8Array): string {
  return Array.from(payload, (byte) => byte.toString(16).padStart(2, '0')).join(' ')
}

function toAscii(payload: Uint8Array): string {
  return Array.from(payload, (byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.')).join('')
}

function formatError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function redirectConsoleToStderr(): void {
  const write = (level: string, args: unknown[]) => {
    const rendered = args.map((arg) => {
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    }).join(' ')
    process.stderr.write(`[${level}] ${rendered}\n`)
  }
  console.debug = (...args: unknown[]) => write('debug', args)
  console.log = (...args: unknown[]) => write('log', args)
  console.warn = (...args: unknown[]) => write('warn', args)
  console.error = (...args: unknown[]) => write('error', args)
}

function renderMarkdown(report: ProbeReport): string {
  const lines: string[] = []
  lines.push('# MoQ Recorder Probe Report')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Endpoint: ${report.endpoint}`)
  lines.push(`Broadcast: ${report.broadcast}`)
  lines.push('')
  lines.push('## Runtime')
  lines.push(`- Node: ${report.runtime.nodeVersion} (${report.runtime.platform})`)
  lines.push(`- Native WebTransport: ${report.runtime.hasNativeWebTransport ? 'yes' : 'no'}`)
  lines.push(`- Native WebSocket: ${report.runtime.hasNativeWebSocket ? 'yes' : 'no'}`)
  lines.push(`- Required QUIC APIs available: ${report.runtime.requiredQuicApisAvailable ? 'yes' : 'no'}`)
  lines.push(`- Runtime recommendation: ${report.runtime.recommendedRuntime}`)
  lines.push('')
  lines.push('## Connection')
  if (report.connection?.ok) {
    lines.push(`- OK: yes`)
    lines.push(`- Protocol version: ${report.connection.protocolVersion ?? 'unknown'}`)
    lines.push(`- URL: ${report.connection.url ?? 'unknown'}`)
  } else {
    lines.push(`- OK: no`)
    lines.push(`- Error: ${report.connection?.error ?? 'not attempted'}`)
  }
  lines.push('')
  lines.push('## Catalog')
  lines.push(`- Format: ${report.catalog.format}`)
  lines.push(`- Catalog track: ${report.catalog.trackName ?? 'none'}`)
  if (report.catalog.error) lines.push(`- Error: ${report.catalog.error}`)
  lines.push(`- Tracks discovered: ${report.catalog.tracks.length}`)
  for (const track of report.catalog.tracks) {
    lines.push(`  - ${track.name}: kind=${track.mediaKind} codec=${track.codec ?? 'unknown'} container=${JSON.stringify(track.container ?? null)}`)
  }
  lines.push('')
  lines.push('## Payload inspections')
  for (const track of report.tracks) {
    lines.push(`### ${track.track.name}`)
    lines.push(`- Subscribed: ${track.subscribed ? 'yes' : 'no'}`)
    if (track.error) lines.push(`- Error: ${track.error}`)
    lines.push(`- Groups observed: ${track.groupsObserved}`)
    lines.push(`- Frames/objects observed: ${track.framesObserved}`)
    lines.push(`- Group mapping: ${track.groupMappingConclusion}`)
    for (const evidence of track.groupMappingEvidence) lines.push(`  - ${evidence}`)
    for (const inspection of track.inspections) {
      lines.push(`- group=${inspection.groupId} frame=${inspection.frameId ?? 'unknown'} alias=not-exposed subgroup=not-exposed bytes=${inspection.payloadLength}`)
      lines.push(`  - first bytes: ${inspection.firstBytesHex}`)
      lines.push(`  - ascii: ${inspection.firstBytesAscii}`)
      lines.push(`  - signatures: ${inspection.signatures.join(', ') || 'none'}`)
      lines.push(`  - boxes: ${inspection.isoBmffBoxes.map((box) => `${box.type}@${box.offset}:${box.size}`).join(', ') || 'none'}`)
      lines.push(`  - elementary hints: ${inspection.elementaryStreamHints.join(', ')}`)
      if (inspection.cmaf.decodeTimestampUs !== undefined) lines.push(`  - CMAF decode timestamp: ${inspection.cmaf.decodeTimestampUs} us`)
      if (inspection.cmaf.decodeTimestampError) lines.push(`  - CMAF timestamp error: ${inspection.cmaf.decodeTimestampError}`)
    }
  }
  lines.push('')
  lines.push('## Timestamp strategy')
  for (const item of report.timestampStrategy) lines.push(`- ${item}`)
  lines.push('')
  lines.push('## Payload format')
  lines.push(report.payloadFormat)
  lines.push('')
  lines.push('## Recommended recorder design')
  lines.push(report.recommendedRecorderDesign)
  lines.push('')
  lines.push('## Limitations')
  for (const item of report.limitations) lines.push(`- ${item}`)
  lines.push('')
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  redirectConsoleToStderr()
  const report = await runProbe(options)
  if (options.output === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(renderMarkdown(report))
  }
  if (!report.connection?.ok) process.exitCode = 2
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`)
  process.exitCode = 1
})
