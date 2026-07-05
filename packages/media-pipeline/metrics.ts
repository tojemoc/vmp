/**
 * Fire-and-forget DogStatsD client for the transcoding VM.
 *
 * Metrics are sent to the local Datadog Agent (default 127.0.0.1:8125), which
 * forwards them to Datadog. Disable with DD_METRICS_ENABLED=0.
 *
 * Env:
 *   DD_AGENT_HOST       — default 127.0.0.1
 *   DD_DOGSTATSD_PORT   — default 8125
 *   DD_METRICS_ENABLED  — default 1; set 0 to no-op
 *   DD_ENV              — optional tag on every metric (e.g. production)
 *   DD_SERVICE          — optional tag (default vmp-transcoder)
 */

import dgram from 'node:dgram'

const enabled = process.env.DD_METRICS_ENABLED !== '0'
const host = (process.env.DD_AGENT_HOST || '127.0.0.1').trim()
const port = Math.max(1, Number.parseInt(process.env.DD_DOGSTATSD_PORT || '8125', 10) || 8125)
const defaultTags: Record<string, string> = {}

const ddEnv = (process.env.DD_ENV || '').trim()
if (ddEnv) defaultTags.env = ddEnv
defaultTags.service = (process.env.DD_SERVICE || 'vmp-transcoder').trim() || 'vmp-transcoder'

let socket: dgram.Socket | null = null

function getSocket(): dgram.Socket {
  if (!socket) socket = dgram.createSocket('udp4')
  return socket
}

function formatTags(tags?: Record<string, string>): string {
  const merged = { ...defaultTags, ...tags }
  const entries = Object.entries(merged).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return ''
  return `|#${entries.map(([k, v]) => `${k}:${v}`).join(',')}`
}

function send(metric: string): void {
  if (!enabled) return
  try {
    getSocket().send(metric, port, host, () => {})
  } catch {
    // Metrics must never block or crash the transcoder.
  }
}

/** Counter increment (default +1). */
export function increment(name: string, value = 1, tags?: Record<string, string>): void {
  send(`${name}:${value}|c${formatTags(tags)}`)
}

/** Point-in-time gauge. */
export function gauge(name: string, value: number, tags?: Record<string, string>): void {
  send(`${name}:${value}|g${formatTags(tags)}`)
}

/** Duration histogram (milliseconds). */
export function histogram(name: string, valueMs: number, tags?: Record<string, string>): void {
  if (!Number.isFinite(valueMs) || valueMs < 0) return
  send(`${name}:${Math.round(valueMs)}|ms${formatTags(tags)}`)
}
