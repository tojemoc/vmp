/**
 * PostHog Node SDK helper for the API Worker.
 *
 * Uses captureImmediate + flushAt:1 so events are sent before the isolate exits.
 * No-ops when POSTHOG_PROJECT_TOKEN (or POSTHOG_KEY) is unset.
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

type PostHogCaptureHandler = (input: PostHogCaptureInput) => Promise<void> | void;
type PostHogExceptionHandler = (
  error: unknown,
  distinctId: string,
  properties?: Record<string, unknown>,
) => Promise<void> | void;

let captureHandler: PostHogCaptureHandler | null = null;
let exceptionHandler: PostHogExceptionHandler | null = null;

export function setPostHogCaptureForTests(handler: PostHogCaptureHandler | null): void {
  captureHandler = handler;
}

export function setPostHogExceptionForTests(handler: PostHogExceptionHandler | null): void {
  exceptionHandler = handler;
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

export function posthogContextFromRequest(request: Request | undefined): {
  distinctId: string | null;
  sessionId: string | null;
} {
  if (!request) return { distinctId: null, sessionId: null };
  const distinctId = request.headers.get('X-POSTHOG-DISTINCT-ID')?.trim() || null;
  const sessionId = request.headers.get('X-POSTHOG-SESSION-ID')?.trim() || null;
  return { distinctId, sessionId };
}

function sessionProperties(sessionId: string | null): Record<string, unknown> {
  return sessionId ? { $session_id: sessionId } : {};
}

export async function capturePostHogEvent(
  env: Record<string, unknown> | undefined,
  input: PostHogCaptureInput,
  request?: Request,
): Promise<void> {
  const distinctId = input.distinctId.trim();
  if (!distinctId) return;

  const { sessionId } = posthogContextFromRequest(request);
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

  if (captureHandler) {
    await captureHandler(payload);
    return;
  }

  const client = createPostHogClient(env);
  if (!client) return;
  try {
    await client.captureImmediate({
      distinctId: payload.distinctId,
      event: payload.event,
      properties,
    });
  } catch (err) {
    console.error('[posthog] capture failed', err);
  } finally {
    await client.shutdown().catch(() => {});
  }
}

export async function capturePostHogException(
  env: Record<string, unknown> | undefined,
  error: unknown,
  options: { request?: Request; distinctId?: string; properties?: Record<string, unknown> } = {},
): Promise<void> {
  const fromRequest = posthogContextFromRequest(options.request);
  const distinctId = (options.distinctId ?? fromRequest.distinctId ?? '').trim() || 'anonymous';
  const properties = {
    ...sessionProperties(fromRequest.sessionId),
    ...options.properties,
  };

  if (!resolvePostHogProjectToken(env)) return;

  if (exceptionHandler) {
    await exceptionHandler(error, distinctId, properties);
    return;
  }

  const client = createPostHogClient(env);
  if (!client) return;
  try {
    await client.captureExceptionImmediate(error, distinctId, properties);
  } catch (err) {
    console.error('[posthog] exception capture failed', err);
  } finally {
    await client.shutdown().catch(() => {});
  }
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

export async function captureMappedPostHogEvent(
  env: Record<string, unknown> | undefined,
  input: PostHogCaptureInput | null,
): Promise<void> {
  if (!input) return;
  await capturePostHogEvent(env, input);
}
