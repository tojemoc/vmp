import type { CaptureResult } from 'posthog-js';

/** Explicit browser/runtime cancellation messages — not generic "aborted" substrings. */
const KNOWN_ABORT_MESSAGES = new Set([
  'Request aborted',
  'The operation was aborted.',
  'The user aborted a request.',
]);

function isExplicitAbortMessage(message: unknown): boolean {
  return typeof message === 'string' && KNOWN_ABORT_MESSAGES.has(message);
}

/** Benign aborts from navigation superseding in-flight work — not product defects (#611). */
export function isBenignAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (typeof error === 'object' && error !== null) {
    const record = error as { name?: unknown; message?: unknown };
    if (record.name === 'AbortError') return true;
    if (isExplicitAbortMessage(record.message)) return true;
  }
  return false;
}

function isPostHogAbortExceptionItem(record: Record<string, unknown>): boolean {
  const type = String(record.type ?? '');
  const value = String(record.value ?? '');
  if (value === 'AbortError') return true;
  if (type === 'DOMException' && value.includes('AbortError')) return true;
  return isExplicitAbortMessage(record.message);
}

/** Drop PostHog `$exception` events for intentional navigation aborts. */
export function shouldDropPostHogExceptionEvent(event: CaptureResult): boolean {
  if (event.event !== '$exception') return false;
  const list = event.properties?.$exception_list;
  if (!Array.isArray(list)) return false;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (isPostHogAbortExceptionItem(item as Record<string, unknown>)) return true;
  }
  return false;
}
