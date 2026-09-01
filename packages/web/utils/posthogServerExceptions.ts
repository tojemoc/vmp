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
import { httpStatusFromError } from './httpErrorStatus';

export { httpStatusFromError } from './httpErrorStatus';

/** A throw without a status (a real crash) still counts as signal. */
export function shouldCaptureServerException(error: unknown): boolean {
  const status = httpStatusFromError(error);
  if (status === null) return true;
  return status < 400 || status > 499;
}

/**
 * Reduce a request target to route shape before it leaves the Worker.
 *
 * Nitro hands the error hook `event.path`, which is the raw request URL —
 * query string included. `/auth/verify?token=…` carries a live single-use
 * magic-link token, so the query is dropped outright and identifier-looking
 * segments are masked. Mirrors `redactPathForAnalytics` in
 * `packages/api/src/posthog.ts`; keep the two in step.
 */
export function redactErrorPath(path: string): string {
  const [pathname = ''] = path.split(/[?#]/);
  return pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)
      ) {
        return ':id';
      }
      if (/^[0-9a-f]{16,}$/i.test(segment)) return ':token';
      if (/^\d{6,}$/.test(segment)) return ':id';
      if (segment.length > 40) return ':token';
      return segment;
    })
    .join('/');
}

/** One id per fault: server throws have no person, and a shared id would fake a user. */
export function newServerExceptionDistinctId(): string {
  return `web_server_error:${crypto.randomUUID()}`;
}

/** Build PostHog exception properties for a server error with redacted path and anonymous profile flag. */
export function serverExceptionProperties(context: {
  path?: string;
  method?: string;
  status?: number | null;
  environment?: string;
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    // Anonymous per fault — never create a person profile from a server throw.
    $process_person_profile: false,
  };
  const path = context.path ? redactErrorPath(context.path) : '';
  if (path) properties.path = path;
  if (context.method) properties.method = context.method;
  if (context.status !== null && context.status !== undefined) {
    properties.status_code = context.status;
  }
  if (context.environment) properties.$environment = context.environment;
  return properties;
}
