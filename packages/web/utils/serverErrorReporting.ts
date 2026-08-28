/**
 * Which SSR errors are worth sending to PostHog error tracking.
 *
 * Nitro fires its `error` hook for *every* unhandled request outcome, including
 * the deliberate 404 it raises for an unmatched route. Because Nitro puts the
 * request path in the message ("Page not found: /.git/config"), each scanner
 * probe fingerprints as its own issue, so a single bot sweep can manufacture
 * dozens of issues in seconds and bury real exceptions.
 *
 * A 4xx is a statement about the *request*, not a defect in the app, so it is
 * not an exception. Anything without a status is an unclassified crash and is
 * always reported.
 */
import { httpStatusFromError } from './httpErrorStatus';

export function shouldReportServerError(error: unknown): boolean {
  const status = httpStatusFromError(error);
  if (status === null) return true;
  return status >= 500;
}

export type ServerErrorContext = {
  path?: string;
  method?: string;
};

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

/**
 * Properties attached to a reported SSR exception. `$environment` matters
 * because staging and production share one PostHog project token — without it
 * the two tiers are indistinguishable in error tracking.
 */
export function serverErrorProperties(
  error: unknown,
  request: ServerErrorContext | undefined,
  environment: string,
): Record<string, unknown> {
  const status = httpStatusFromError(error);
  const path = request?.path ? redactErrorPath(request.path) : '';
  return {
    // SSR exceptions are not attributable to a person; skip profile processing.
    $process_person_profile: false,
    $environment: environment || 'development',
    ...(path ? { path } : {}),
    ...(request?.method ? { method: request.method } : {}),
    ...(status === null ? {} : { status_code: status }),
  };
}

/** Request-scoped id so unattributed SSR exceptions do not pile onto one person. */
export function anonymousServerErrorDistinctId(): string {
  return `server_error:${crypto.randomUUID()}`;
}
