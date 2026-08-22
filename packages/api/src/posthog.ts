/**
 * PostHog Node SDK helper for the API Worker.
 *
 * Reuses one client per isolate. Callers with an ExecutionContext should pass
 * `ctx` so capture is scheduled via `waitUntil` and does not block webhooks.
 *
 * Runtime env (Cloudflare Worker vars / packages/api/.dev.vars), not GitHub build vars:
 *   POSTHOG_PROJECT_TOKEN — public project token (same value as NUXT_PUBLIC_POSTHOG_KEY)
 *   POSTHOG_HOST          — ingest host, default https://eu.i.posthog.com
 */
import { PostHog } from 'posthog-node';

export const POSTHOG_TRACING_REQUEST_HEADERS = [
  'X-POSTHOG-DISTINCT-ID',
  'X-POSTHOG-SESSION-ID',
] as const;

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

export type PostHogCaptureInput = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

export type PostHogWaitUntilCtx = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

type PostHogCaptureHandler = (input: PostHogCaptureInput) => Promise<void> | void;
type PostHogExceptionHandler = (
  error: unknown,
  distinctId: string,
  properties?: Record<string, unknown>,
) => Promise<void> | void;

let captureHandler: PostHogCaptureHandler | null = null;
let exceptionHandler: PostHogExceptionHandler | null = null;

type CachedClient = {
  key: string;
  client: PostHog;
};

let cachedClient: CachedClient | null = null;

export function setPostHogCaptureForTests(handler: PostHogCaptureHandler | null): void {
  captureHandler = handler;
}

export function setPostHogExceptionForTests(handler: PostHogExceptionHandler | null): void {
  exceptionHandler = handler;
}

export function resetPostHogClientForTests(): void {
  cachedClient = null;
}

export function resolvePostHogProjectToken(env: Record<string, unknown> | undefined): string {
  const token = env?.POSTHOG_PROJECT_TOKEN ?? env?.POSTHOG_KEY;
  return typeof token === 'string' ? token.trim() : '';
}

export function resolvePostHogHost(env: Record<string, unknown> | undefined): string {
  const host = env?.POSTHOG_HOST;
  const trimmed = typeof host === 'string' ? host.trim() : '';
  return trimmed || DEFAULT_POSTHOG_HOST;
}

export function createPostHogClient(env: Record<string, unknown> | undefined): PostHog | null {
  const token = resolvePostHogProjectToken(env);
  if (!token) return null;
  return new PostHog(token, {
    host: resolvePostHogHost(env),
    flushAt: 1,
    flushInterval: 0,
  });
}

function getSharedPostHogClient(env: Record<string, unknown> | undefined): PostHog | null {
  const token = resolvePostHogProjectToken(env);
  if (!token) return null;
  const key = `${token}|${resolvePostHogHost(env)}`;
  if (cachedClient?.key === key) return cachedClient.client;
  const client = createPostHogClient(env);
  if (!client) return null;
  cachedClient = { key, client };
  return client;
}

export function posthogContextFromRequest(request: Request | undefined): {
  distinctId: string | null;
  sessionId: string | null;
} {
  if (!request) return { distinctId: null, sessionId: null };
  const distinctId = request.headers.get('X-POSTHOG-DISTINCT-ID')?.trim() || null;
  const sessionId = request.headers.get('X-POSTHOG-SESSION-ID')?.trim() || null;
  return { distinctId, sessionId };
}

/** Request-scoped id so unauthenticated exceptions do not pile onto one person. */
export function newAnonymousPostHogDistinctId(): string {
  return `server_error:${crypto.randomUUID()}`;
}

/**
 * Replace path identifiers (UUIDs, long tokens, numeric ids) with placeholders
 * so analytics keep route shape without leaking user/video/token segments.
 */
export function redactPathForAnalytics(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          segment,
        )
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

function sessionProperties(sessionId: string | null): Record<string, unknown> {
  return sessionId ? { $session_id: sessionId } : {};
}

function runPostHogWork(
  ctx: PostHogWaitUntilCtx | undefined,
  work: () => Promise<void>,
): Promise<void> | void {
  const promise = work().catch((err) => {
    console.error('[posthog] background work failed', err);
  });
  if (typeof ctx?.waitUntil === 'function') {
    ctx.waitUntil(promise);
    return;
  }
  return promise;
}

export function capturePostHogEvent(
  env: Record<string, unknown> | undefined,
  input: PostHogCaptureInput,
  options: { request?: Request; ctx?: PostHogWaitUntilCtx } = {},
): Promise<void> | void {
  const distinctId = input.distinctId.trim();
  if (!distinctId) return;

  const { sessionId } = posthogContextFromRequest(options.request);
  const properties: Record<string, unknown> = {
    ...sessionProperties(sessionId),
    ...input.properties,
  };
  const payload: PostHogCaptureInput = {
    distinctId,
    event: input.event,
    properties,
  };

  if (!resolvePostHogProjectToken(env)) return;

  return runPostHogWork(options.ctx, async () => {
    if (captureHandler) {
      await captureHandler(payload);
      return;
    }

    const client = getSharedPostHogClient(env);
    if (!client) return;
    await client.captureImmediate({
      distinctId: payload.distinctId,
      event: payload.event,
      properties,
    });
  });
}

export function capturePostHogException(
  env: Record<string, unknown> | undefined,
  error: unknown,
  options: {
    request?: Request;
    distinctId?: string;
    properties?: Record<string, unknown>;
    ctx?: PostHogWaitUntilCtx;
  } = {},
): Promise<void> | void {
  const fromRequest = posthogContextFromRequest(options.request);
  const resolved = (options.distinctId ?? fromRequest.distinctId ?? '').trim();
  const distinctId = resolved || newAnonymousPostHogDistinctId();
  const properties = {
    ...sessionProperties(fromRequest.sessionId),
    ...(resolved ? {} : { anonymous_exception: true }),
    ...options.properties,
  };

  if (!resolvePostHogProjectToken(env)) return;

  return runPostHogWork(options.ctx, async () => {
    if (exceptionHandler) {
      await exceptionHandler(error, distinctId, properties);
      return;
    }

    const client = getSharedPostHogClient(env);
    if (!client) return;
    await client.captureExceptionImmediate(error, distinctId, properties);
  });
}

export function posthogEventFromStripeWebhook(
  type: string,
  object: Record<string, unknown>,
  userId: string,
): PostHogCaptureInput | null {
  const distinctId = userId.trim();
  if (!distinctId) return null;

  const metadata =
    object.metadata && typeof object.metadata === 'object'
      ? (object.metadata as Record<string, unknown>)
      : {};
  const planType = typeof metadata.planType === 'string' ? metadata.planType : undefined;
  const base = {
    source: 'stripe_webhook',
    stripe_event: type,
    provider: 'stripe',
  };

  if (type === 'checkout.session.completed') {
    return {
      distinctId,
      event: 'subscription_activated',
      properties: { ...base, ...(planType ? { plan_type: planType } : {}) },
    };
  }
  if (type === 'customer.subscription.deleted') {
    return {
      distinctId,
      event: 'subscription_cancelled',
      properties: base,
    };
  }
  if (type === 'invoice.paid') {
    const billingReason = typeof object.billing_reason === 'string' ? object.billing_reason : '';
    if (billingReason !== 'subscription_cycle' && billingReason !== 'subscription_update') {
      return null;
    }
    return {
      distinctId,
      event: 'subscription_renewed',
      properties: { ...base, billing_reason: billingReason },
    };
  }
  if (type === 'invoice.payment_failed') {
    return {
      distinctId,
      event: 'subscription_payment_failed',
      properties: base,
    };
  }
  return null;
}

export function posthogEventFromLegacyWebhook(
  status: string,
  userId: string,
): PostHogCaptureInput | null {
  const distinctId = userId.trim();
  if (!distinctId) return null;
  const base = { source: 'legacy_webhook', provider: 'legacy' };
  if (status === 'cancelled') {
    return { distinctId, event: 'subscription_cancelled', properties: base };
  }
  if (status === 'past_due') {
    return { distinctId, event: 'subscription_payment_failed', properties: base };
  }
  return null;
}

export function captureMappedPostHogEvent(
  env: Record<string, unknown> | undefined,
  input: PostHogCaptureInput | null,
  ctx?: PostHogWaitUntilCtx,
): Promise<void> | void {
  if (!input) return;
  return capturePostHogEvent(env, input, ctx ? { ctx } : {});
}
