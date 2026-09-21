import type { CaptureResult } from 'posthog-js';

/** Explicit browser/runtime cancellation messages — not generic "aborted" substrings. */
const KNOWN_ABORT_MESSAGES = new Set([
  'Request aborted',
  'The operation was aborted.',
  'The user aborted a request.',
]);

/** Check if a message matches a known browser/runtime abort message. */
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

/** Check if a PostHog exception list item represents an abort error. */
function isPostHogAbortExceptionItem(record: Record<string, unknown>): boolean {
  const type = String(record.type ?? '');
  const value = String(record.value ?? '');
  if (value === 'AbortError') return true;
  if (type === 'DOMException' && value.includes('AbortError')) return true;
  return isExplicitAbortMessage(record.message);
}

/** Opaque message a browser reports for a cross-origin script fault with no CORS header. */
const SCRIPT_ERROR_MESSAGES = new Set(['Script error.', 'Script error']);

/** Check if a PostHog exception list item carries no usable stack frames. */
function hasNoStackFrames(record: Record<string, unknown>): boolean {
  const stacktrace = record.stacktrace;
  if (!stacktrace || typeof stacktrace !== 'object') return true;
  const frames = (stacktrace as { frames?: unknown }).frames;
  return !Array.isArray(frames) || frames.length === 0;
}

/**
 * Check if a PostHog exception list item is an opaque `Script error.` with no stack.
 * These carry no message and no source location, so they open issues that hold
 * nothing to act on. A real fault (message plus stack) is kept.
 */
function isStacklessScriptError(record: Record<string, unknown>): boolean {
  const value = String(record.value ?? '');
  const message = String(record.message ?? '');
  if (!SCRIPT_ERROR_MESSAGES.has(value) && !SCRIPT_ERROR_MESSAGES.has(message)) return false;
  return hasNoStackFrames(record);
}

/** Drop PostHog `$exception` events for intentional navigation aborts. */
export function shouldDropPostHogExceptionEvent(event: CaptureResult): boolean {
  if (event.event !== '$exception') return false;
  const list = event.properties?.$exception_list;
  if (!Array.isArray(list)) return false;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (isPostHogAbortExceptionItem(record)) return true;
    if (isStacklessScriptError(record)) return true;
  }
  return false;
}
