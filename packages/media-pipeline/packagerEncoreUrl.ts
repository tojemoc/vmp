/**
 * Encore job URLs must be reachable from the encore-packager container.
 * Host supervisors often use http://127.0.0.1:8080 — rewrite those for Docker DNS.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** True when hostname is only valid inside the supervisor/host process, not packager. */
export function isLoopbackEncoreUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString);
    return LOOPBACK_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Rewrite Encore job URL so encore-packager can GET it.
 *
 * Priority:
 * 1. PACKAGER_ENCORE_BASE_URL (explicit)
 * 2. If URL is loopback → http://encore-web:8080 (Compose service name)
 * 3. Otherwise leave unchanged (already docker-DNS or public)
 */
export function rewriteEncoreJobUrlForPackager(
  encoreJobUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = String(encoreJobUrl ?? '').trim();
  if (!raw) return raw;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  const explicit = (env.PACKAGER_ENCORE_BASE_URL || '').trim();
  if (explicit) {
    const base = new URL(trimTrailingSlash(explicit.includes('://') ? explicit : `http://${explicit}`));
    parsed.protocol = base.protocol;
    parsed.host = base.host;
    return parsed.toString();
  }

  if (isLoopbackEncoreUrl(raw)) {
    parsed.hostname = 'encore-web';
    parsed.port = parsed.port || '8080';
    if (parsed.protocol === 'https:') parsed.protocol = 'http:';
    return parsed.toString();
  }

  return raw;
}
