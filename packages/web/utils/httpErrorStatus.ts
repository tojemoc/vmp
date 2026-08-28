/**
 * Reads the HTTP status code carried by an error.
 *
 * Covers both shapes we throw or receive on the frontend:
 *   - `FetchError` from `$fetch` / `useFetch` — `statusCode` + `status` + `response.status`
 *   - `H3Error` / `createError()` payloads — `statusCode`
 *
 * Returns `null` when the error carries no status. That case matters: a DNS
 * failure, TLS error, timeout or abort against the API never has a status, and
 * must not be read as "the upstream said this resource is gone".
 */
export function httpStatusFromError(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as {
    statusCode?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const status = candidate.statusCode ?? candidate.response?.status ?? candidate.status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

/** True when the upstream explicitly said the resource does not exist. */
export function isNotFoundError(error: unknown): boolean {
  return httpStatusFromError(error) === 404;
}
