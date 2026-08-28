/**
 * PostHog Logs (OTLP over HTTP) for the API Worker.
 *
 * Endpoint: {POSTHOG_HOST}/i/v1/logs
 * Auth: Authorization: Bearer {POSTHOG_PROJECT_TOKEN}
 *
 * Enabled when POSTHOG_PROJECT_TOKEN is set. Opt out with POSTHOG_LOGS_ENABLED=false.
 *
 * @see https://posthog.com/docs/logs/installation/other
 */
import {
  DEFAULT_POSTHOG_HOST,
  resolvePostHogEnvironment,
  resolvePostHogHost,
  resolvePostHogProjectToken,
} from './posthog.js';

export type PostHogLogEntry = {
  level: 'info' | 'warn' | 'error';
  ts: string;
  service: string;
  event: string;
  http_method?: string;
  http_path?: string;
  http_status?: number;
  duration_ms?: number;
  error_message?: string;
  [key: string]: unknown;
};

export type PostHogLogTracingContext = {
  distinctId?: string | null;
  sessionId?: string | null;
};

type OtlpAttribute = { key: string; value: Record<string, unknown> };

function otlpStringValue(value: string): Record<string, unknown> {
  return { stringValue: value };
}

function otlpAttribute(key: string, value: unknown): OtlpAttribute | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return { key, value: otlpStringValue(value) };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { key, value: { intValue: String(Math.trunc(value)) } };
  }
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  return { key, value: otlpStringValue(String(value)) };
}

function severityForLevel(level: PostHogLogEntry['level']): {
  severityText: string;
  severityNumber: number;
} {
  if (level === 'error') return { severityText: 'ERROR', severityNumber: 17 };
  if (level === 'warn') return { severityText: 'WARN', severityNumber: 13 };
  return { severityText: 'INFO', severityNumber: 9 };
}

/** Human-readable log body (matches Datadog message column). */
export function formatPostHogLogBody(entry: PostHogLogEntry): string {
  const parts: string[] = [];
  if (entry.http_method && entry.http_path) {
    parts.push(`${entry.http_method} ${entry.http_path}`);
    if (entry.http_status != null) parts.push(`→ ${entry.http_status}`);
  }
  parts.push(entry.event);
  if (entry.error_message) {
    parts.push(String(entry.error_message));
  } else if (entry.duration_ms != null) {
    parts.push(`${entry.duration_ms}ms`);
  }
  const summary = parts.join(' ');
  const component = String(entry.service ?? '').trim();
  return component ? `${component}: ${summary}` : summary;
}

export function isPostHogLogsEnabled(env: Record<string, unknown>): boolean {
  if (!resolvePostHogProjectToken(env)) return false;
  const flag = String(env.POSTHOG_LOGS_ENABLED ?? '')
    .trim()
    .toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  return true;
}

export function buildPostHogLogsUrl(env: Record<string, unknown>): string {
  const host = resolvePostHogHost(env).replace(/\/$/, '') || DEFAULT_POSTHOG_HOST;
  return `${host}/i/v1/logs`;
}

export function buildPostHogOtlpPayload(
  entries: PostHogLogEntry[],
  env: Record<string, unknown>,
  tracing: PostHogLogTracingContext = {},
): Record<string, unknown> {
  const serviceName =
    String(env.POSTHOG_LOGS_SERVICE ?? env.DD_SERVICE ?? 'vmp-api').trim() || 'vmp-api';
  const environment = resolvePostHogEnvironment(env);

  const resourceAttributes = [
    otlpAttribute('service.name', serviceName),
    otlpAttribute('deployment.environment', environment),
  ].filter((attr): attr is OtlpAttribute => attr !== null);

  const logRecords = entries.map((entry) => {
    const { severityText, severityNumber } = severityForLevel(entry.level ?? 'info');
    const attributes: OtlpAttribute[] = [];

    if (tracing.distinctId) {
      const attr = otlpAttribute('posthogDistinctId', tracing.distinctId);
      if (attr) attributes.push(attr);
    }
    if (tracing.sessionId) {
      const attr = otlpAttribute('sessionId', tracing.sessionId);
      if (attr) attributes.push(attr);
    }

    for (const [key, value] of Object.entries(entry)) {
      if (key === 'level' || key === 'ts') continue;
      if (key === 'service') {
        const component = otlpAttribute('component', value);
        if (component) attributes.push(component);
        continue;
      }
      const attr = otlpAttribute(key, value);
      if (attr) attributes.push(attr);
    }

    const timeMs = Date.parse(entry.ts);
    const timeUnixNano = String((Number.isFinite(timeMs) ? timeMs : Date.now()) * 1_000_000);

    return {
      timeUnixNano,
      severityNumber,
      severityText,
      body: otlpStringValue(formatPostHogLogBody(entry)),
      attributes,
    };
  });

  return {
    resourceLogs: [
      {
        resource: { attributes: resourceAttributes },
        scopeLogs: [
          {
            scope: { name: serviceName },
            logRecords,
          },
        ],
      },
    ],
  };
}

export async function flushPostHogLogs(
  env: Record<string, unknown>,
  entries: PostHogLogEntry[],
  tracing: PostHogLogTracingContext = {},
): Promise<void> {
  const token = resolvePostHogProjectToken(env);
  if (!token || entries.length === 0) return;

  const response = await fetch(buildPostHogLogsUrl(env), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildPostHogOtlpPayload(entries, env, tracing)),
  });

  if (!response.ok) {
    console.error(`[posthog] log upload failed: HTTP ${response.status}`);
  }
}
