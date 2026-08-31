/**
 * Which server-side throws are worth reporting to PostHog error tracking.
 *
 * Nitro's `error` hook fires for every unhandled H3 error, and plain HTTP 404s are H3
 * errors too: vulnerability scanners walking `/.env`, `/.git/config` and friends, plus
 * the deliberate `createError({ statusCode: 404 })` throws in `pages/[slug].vue`.
 * Captured as exceptions they open one error tracking issue per probed path — each
 * firing the new-issue alert and a Linear ticket — and bury the genuine app errors.
 * A 4xx says the request was wrong, not the server, so only faults are signal.
 */

function toStatusNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** HTTP status carried by an H3Error or `$fetch` error, when it has one. */
export function httpStatusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { statusCode?: unknown; status?: unknown };
  return toStatusNumber(candidate.statusCode) ?? toStatusNumber(candidate.status);
}

/** A throw without a status (a real crash) still counts as signal. */
export function shouldCaptureServerException(error: unknown): boolean {
  const status = httpStatusFromError(error);
  return status === undefined || status < 400 || status > 499;
}

/** Nitro's `event.path` carries the query string — keep the route, drop the params. */
function pathnameOf(path: string | undefined): string {
  if (!path) return '';
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

/** One id per fault: server throws have no person, and a shared id would fake a user. */
export function newServerExceptionDistinctId(): string {
  return `web_server_error:${crypto.randomUUID()}`;
}

export function serverExceptionProperties(context: {
  path?: string;
  method?: string;
  status?: number;
  environment?: string;
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    // Anonymous per fault — never create a person profile from a server throw.
    $process_person_profile: false,
  };
  const path = pathnameOf(context.path);
  if (path) properties.path = path;
  if (context.method) properties.method = context.method;
  if (context.status !== undefined) properties.status_code = context.status;
  if (context.environment) properties.$environment = context.environment;
  return properties;
}
