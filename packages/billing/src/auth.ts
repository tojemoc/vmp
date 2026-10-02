/**
 * Slim auth for the billing Worker — JWT verify + role checks only.
 * Shares JWT_SECRET with the API Worker (same issuer).
 */
import { d1FirstOptionalColumn } from './d1OptionalColumn.js';
import { getDb } from './d1Session.js';

export const ROLES = ['super_admin', 'admin', 'editor', 'analyst', 'moderator', 'viewer'] as const;

const ROLES_REQUIRING_2FA = ['editor', 'analyst', 'moderator', 'admin', 'super_admin'];

/** Thrown when billing cannot verify JWTs (missing secret) vs a bad/expired user token. */
export class BillingAuthConfigError extends Error {
  readonly code = 'billing_auth_misconfigured' as const;
  readonly status = 503;
  constructor(message = 'JWT_SECRET not configured') {
    super(message);
    this.name = 'BillingAuthConfigError';
  }
}

export function isBillingAuthConfigError(err: unknown): err is BillingAuthConfigError {
  return (
    err instanceof BillingAuthConfigError ||
    (err instanceof Error &&
      (err as { code?: string }).code === 'billing_auth_misconfigured') ||
    (err instanceof Error && err.message === 'JWT_SECRET not configured')
  );
}

/** Map requireAuth/requireRole failures to HTTP responses (503 when secrets missing). */
export function authFailureResponse(
  err: unknown,
  corsHeaders: Record<string, string> = {},
): Response {
  if (isBillingAuthConfigError(err)) {
    return new Response(
      JSON.stringify({
        error: 'Billing auth not configured',
        code: 'billing_auth_misconfigured',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      },
    );
  }
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function base64urlDecode(str: string): ArrayBuffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, any>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const [headerB64, payloadB64, sigB64] = parts;
  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error('Invalid JWT signature');
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('JWT expired');
  return payload;
}

export async function requireAuth(request: Request, env: { JWT_SECRET?: string; video_subscription_db?: D1Database; DB?: D1Database }) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) throw new Error('Missing Bearer token');
  const secret = String(env.JWT_SECRET || '');
  // Treat whitespace-only as unset; keep original for HMAC (matches API Worker).
  if (!secret.trim()) throw new BillingAuthConfigError();
  const token = header.slice(7);
  const payload = await verifyJwt(token, secret);
  if (payload.pending) throw new Error('2FA verification required');
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!sub) throw new Error('Invalid token subject');
  const userRow = await d1FirstOptionalColumn(getDb(env), {
    column: 'deletion_pending',
    sql: 'SELECT deletion_pending FROM users WHERE id = ? LIMIT 1',
    fallbackSql: 'SELECT id FROM users WHERE id = ? LIMIT 1',
    binds: [sub],
    fallbackValue: 0,
    logService: 'billing-auth',
    logEvent: 'd1_missing_deletion_pending_column',
  });
  if (!userRow) throw new Error('User no longer exists');
  if (Number(userRow.deletion_pending) === 1) {
    throw new Error('Account deletion pending');
  }
  return payload;
}

export async function requireRole(
  request: Request,
  env: { JWT_SECRET?: string; video_subscription_db?: D1Database; DB?: D1Database },
  ...roles: string[]
) {
  const user = await requireAuth(request, env);
  const routeNeedsTotp = roles.some((r) => ROLES_REQUIRING_2FA.includes(r));
  if (
    routeNeedsTotp &&
    ROLES_REQUIRING_2FA.includes(user.role) &&
    user.totpRequired &&
    !user.totpEnabled
  ) {
    throw new Error('2FA enrollment required');
  }
  if (!roles.includes(user.role)) {
    throw new Error(`Insufficient role. Required: ${roles.join(' | ')}. Got: ${user.role}`);
  }
  return user;
}
