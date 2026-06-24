/**
 * Logs emitted by this module are shipped to Datadog via Workers Logpush.
 * In Datadog, create a Grok parser under Logs > Configuration > Pipelines with:
 *   Filter: source:cloudflare-workers
 *   Rule: json_rule %{data::json}
 * This parses the JSON object into facets (duration_ms, service, event, etc.)
 * that can be used in monitors and dashboards.
 */

type LogLevel = 'info' | 'warn' | 'error'

export interface LogFields {
  service: string
  event: string
  level?: LogLevel
  duration_ms?: number
  http_method?: string
  http_path?: string
  http_status?: number
  video_id?: string
  user_id_hash?: string
  error_code?: string
  error_message?: string
  [key: string]: unknown
}

export function log(fields: LogFields): void {
  console.log(JSON.stringify({
    level: 'info',
    ...fields,
    ts: new Date().toISOString(),
  }))
}

/** Convenience: hash any string to a short hex prefix safe for logs */
export async function hashForLog(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
