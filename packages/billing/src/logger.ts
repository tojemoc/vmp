/** Minimal structured logger for the billing Worker (no Datadog/PostHog metrics stack). */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(entry: {
  service?: string;
  event?: string;
  level?: LogLevel;
  error_code?: string;
  error_message?: string;
  [key: string]: unknown;
}): void {
  const level = entry.level ?? 'info';
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
