/** Benign aborts from navigation superseding in-flight work — not product defects (#611). */
export function isBenignAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (name === 'AbortError') return true;
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && /request aborted|aborted/i.test(message)) return true;
  }
  return false;
}

/** Drop PostHog `$exception` events for intentional navigation aborts. */
export function shouldDropPostHogExceptionEvent(event: {
  event?: string;
  properties?: Record<string, unknown>;
}): boolean {
  if (event.event !== '$exception') return false;
  const list = event.properties?.$exception_list;
  if (!Array.isArray(list)) return false;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const type = String(record.type ?? '');
    const value = String(record.value ?? '');
    if (type === 'DOMException' && (value === 'AbortError' || value.includes('AbortError'))) {
      return true;
    }
    if (value === 'AbortError') return true;
    const message = record.message;
    if (typeof message === 'string' && /request aborted|aborted/i.test(message)) return true;
  }
  return false;
}
