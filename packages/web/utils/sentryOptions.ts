import type { ErrorEvent, Log } from '@sentry/core';

import { isBenignAbortError } from '~/utils/analytics/noiseFilter';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'token',
  'secret',
  'api_key',
  'apikey',
  'x-smoke-token',
]);

export function parseTracesSampleRate(value: unknown, defaultRate = 0.1): number {
  if (typeof value !== 'string' || !value.trim()) return defaultRate;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return defaultRate;
  return Math.min(1, Math.max(0, parsed));
}

export function parseEnvBoolean(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export type SentryPublicConfig = {
  dsn: string;
  tracesSampleRate: number;
  environment: string;
  enableLogs: boolean;
};

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...record };
  for (const key of Object.keys(redacted)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      redacted[key] = '[Redacted]';
    }
  }
  return redacted;
}

/** Vite/esbuild HMR noise when locale modules briefly fail to compile in dev. */
export function isViteLocaleTransformNoise(message: string | undefined): boolean {
  if (!message) return false;
  return message.includes('Transform failed with') && message.includes('/locales/');
}

/**
 * Runtime ReferenceError from ephemeral dev edits. esbuild emits bare identifiers
 * like `INVALID` that TypeScript would reject in CI, so this cannot ship in
 * production bundles from committed source.
 */
export function isDevEphemeralReferenceNoise(message: string | undefined): boolean {
  if (!message) return false;
  return message.includes('INVALID is not defined');
}

function getSentryErrorMessage(event: ErrorEvent): string | undefined {
  const exceptionValue = event.exception?.values?.[0]?.value;
  if (typeof exceptionValue === 'string' && exceptionValue.trim()) {
    return exceptionValue;
  }
  if (typeof event.message === 'string' && event.message.trim()) {
    return event.message;
  }
  return undefined;
}

export function buildSentryInitOptions(config: SentryPublicConfig) {
  if (!config.dsn) return null;

  const options: {
    dsn: string;
    tracesSampleRate: number;
    environment?: string;
    enableLogs: boolean;
    beforeSend?: (event: ErrorEvent, hint?: { originalException?: unknown }) => ErrorEvent | null;
    beforeSendLog?: (log: Log) => Log | null;
  } = {
    dsn: config.dsn,
    tracesSampleRate: config.tracesSampleRate,
    enableLogs: config.enableLogs,
  };

  if (config.environment) {
    options.environment = config.environment;
  }

  options.beforeSend = (event, hint) => {
    if (isBenignAbortError(hint?.originalException)) {
      return null;
    }
    const message = getSentryErrorMessage(event);
    if (isViteLocaleTransformNoise(message) || isDevEphemeralReferenceNoise(message)) {
      return null;
    }

    if (event.request?.headers) {
      event.request.headers = redactRecord(
        event.request.headers as Record<string, unknown>,
      ) as Record<string, string>;
    }
    return event;
  };

  if (config.enableLogs) {
    options.beforeSendLog = (log) => {
      if (log.attributes) {
        log.attributes = redactRecord(
          log.attributes as Record<string, unknown>,
        ) as Log['attributes'];
      }
      return log;
    };
  }

  return options;
}
