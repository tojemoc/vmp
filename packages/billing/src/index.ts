/**
 * vmp-billing — slim auditable billing Worker.
 *
 * Owns checkout, cancel, portal, pricing, payment admin, webhooks, Comgate renewals,
 * Qerko/legacy payment routes, legacy-migration probes, e-invoicing, promotions/ISIC,
 * and subscription transfer.
 *
 * API Worker proxies these paths via service binding `BILLING.fetch(request)`.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type {
  CancelSubscriptionResult,
  CreateSubscriptionParams,
  PaymentProviderId,
  PspSource,
  SubscriptionRecord,
  SubscriptionResult,
} from '@vmp/payments';
import { createBillingMiddleware, type BillingWorkerEnv } from './compose.js';
import {
  handleAccountInvoices,
  handleAdminEInvoiceById,
  handleAdminEInvoices,
  handleAdminEInvoicingSettings,
} from './eInvoicing.js';
import {
  handleAdminLegacyMigrationRelinkCandidates,
  handleAdminLegacyMigrationSendRelinkEmail,
  handleAdminLegacyMigrationStats,
  handleAdminLegacyMigrationValidateBatch,
} from './legacyMigration.js';
import {
  handleAdminLegacyPaymentSettings,
  handleLegacyCheckout,
  handleLegacyComplete,
  handleLegacyOrderStatus,
  handleLegacyWebhook,
} from './legacyPayments.js';
import { getPaymentProviders } from './paymentProviders.js';
import {
  handleAdminPaymentPlans,
  handleAdminPaymentSettings,
  handleCancelSubscription,
  handleCheckout,
  handleComgateWebhook,
  handleGetPricing,
  handleGetStripeConfig,
  handleGetSubscription,
  handleGoPayWebhook,
  handlePortal,
  handleSessionStatus,
  handleWebhook,
  runComgateRenewalJobs,
} from './payments.js';
import {
  handleAdminIsicCampaigns,
  handleAdminPromoCampaigns,
  handleAdminPromoCodes,
  handleIsicCampaignPublic,
  handleIsicValidate,
  handlePromoValidate,
} from './promotions.js';
import {
  handleAccountTransferSubscription,
  handleAdminTransferSubscription,
} from './subscriptionTransfer.js';

function corsHeadersFor(request: Request, env: BillingWorkerEnv): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = String((env as { ALLOWED_ORIGINS?: string }).ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin =
    origin && (allowed.includes(origin) || allowed.includes('*')) ? origin : allowed[0] || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-Posthog-Distinct-Id, X-Posthog-Session-Id, X-Posthog-Window-Id',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
}

async function routeBillingRequest(
  request: Request,
  env: BillingWorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const cors = corsHeadersFor(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (path === '/api/health' || path === '/health') {
    return Response.json({ service: 'vmp-billing', ok: true }, { headers: cors });
  }

  if (path === '/api/account/pricing' && request.method === 'GET') {
    return handleGetPricing(request, env, cors);
  }
  if (path === '/api/account/subscription' && request.method === 'GET') {
    return handleGetSubscription(request, env, cors);
  }
  if (path === '/api/payments/stripe-config' && request.method === 'GET') {
    return handleGetStripeConfig(request, env, cors);
  }
  if (path === '/api/payments/checkout' && request.method === 'POST') {
    return handleCheckout(request, env, cors);
  }
  if (path === '/api/payments/session-status' && request.method === 'GET') {
    return handleSessionStatus(request, env, cors);
  }
  if (
    (path === '/api/payments/webhook' || path === '/api/payments/webhook/stripe') &&
    request.method === 'POST'
  ) {
    return handleWebhook(request, env, cors, 'stripe', ctx);
  }
  if (path === '/api/payments/webhook/gopay' && request.method === 'GET') {
    return handleGoPayWebhook(request, env, cors);
  }
  if (path === '/api/payments/webhook/comgate' && request.method === 'POST') {
    return handleComgateWebhook(request, env, cors);
  }
  if (path === '/api/payments/webhook/legacy' && request.method === 'POST') {
    return handleLegacyWebhook(request, env, cors, ctx);
  }
  if (path === '/api/payments/legacy/checkout' && request.method === 'POST') {
    return handleLegacyCheckout(request, env, cors);
  }
  if (path === '/api/payments/legacy/complete' && request.method === 'POST') {
    return handleLegacyComplete(request, env, cors);
  }
  if (path === '/api/payments/legacy/order-status' && request.method === 'GET') {
    return handleLegacyOrderStatus(request, env, cors);
  }
  if (path === '/api/payments/portal' && request.method === 'POST') {
    return handlePortal(request, env, cors);
  }
  if (path === '/api/payments/cancel' && request.method === 'POST') {
    return handleCancelSubscription(request, env, cors);
  }
  if (
    path === '/api/admin/payments/settings' &&
    (request.method === 'GET' || request.method === 'PATCH')
  ) {
    return handleAdminPaymentSettings(request, env, cors);
  }
  if (
    path === '/api/admin/payments/plans' &&
    (request.method === 'GET' || request.method === 'PUT' || request.method === 'PATCH')
  ) {
    return handleAdminPaymentPlans(request, env, cors);
  }
  if (path === '/api/admin/payments/legacy' && request.method === 'GET') {
    return handleAdminLegacyPaymentSettings(request, env, cors);
  }
  if (path === '/api/admin/legacy-migration/stats' && request.method === 'GET') {
    return handleAdminLegacyMigrationStats(request, env, cors);
  }
  if (path === '/api/admin/legacy-migration/validate-batch' && request.method === 'POST') {
    return handleAdminLegacyMigrationValidateBatch(request, env, cors);
  }
  if (path === '/api/admin/legacy-migration/relink-candidates' && request.method === 'GET') {
    return handleAdminLegacyMigrationRelinkCandidates(request, env, cors);
  }
  if (path === '/api/admin/legacy-migration/send-relink-email' && request.method === 'POST') {
    return handleAdminLegacyMigrationSendRelinkEmail(request, env, cors);
  }

  if (
    path === '/api/admin/einvoicing/settings' &&
    (request.method === 'GET' || request.method === 'PATCH')
  ) {
    return handleAdminEInvoicingSettings(request, env, cors);
  }
  if (path === '/api/admin/einvoicing/invoices' && request.method === 'GET') {
    return handleAdminEInvoices(request, env, cors);
  }
  {
    const eInvoiceById = path.match(/^\/api\/admin\/einvoicing\/invoices\/([^/]+)$/);
    if (eInvoiceById?.[1] && request.method === 'GET') {
      return handleAdminEInvoiceById(request, env, cors, eInvoiceById[1]);
    }
  }
  if (path === '/api/account/invoices' && request.method === 'GET') {
    return handleAccountInvoices(request, env, cors);
  }

  if (
    path === '/api/admin/promotions/campaigns' &&
    (request.method === 'GET' || request.method === 'POST' || request.method === 'PATCH')
  ) {
    return handleAdminPromoCampaigns(request, env, cors);
  }
  if (
    path === '/api/admin/promotions/codes' &&
    (request.method === 'GET' || request.method === 'POST' || request.method === 'PATCH')
  ) {
    return handleAdminPromoCodes(request, env, cors);
  }
  if (
    path === '/api/admin/isic/campaigns' &&
    (request.method === 'GET' || request.method === 'POST' || request.method === 'PATCH')
  ) {
    return handleAdminIsicCampaigns(request, env, cors);
  }
  if (path === '/api/account/promotions/validate' && request.method === 'POST') {
    return handlePromoValidate(request, env, cors);
  }
  if (path === '/api/account/isic/validate' && request.method === 'POST') {
    return handleIsicValidate(request, env, cors);
  }
  if (path === '/api/account/isic/campaigns' && request.method === 'GET') {
    return handleIsicCampaignPublic(request, env, cors);
  }

  if (path === '/api/account/transfer-subscription' && request.method === 'POST') {
    return handleAccountTransferSubscription(request, env, cors);
  }
  if (path === '/api/admin/users/transfer-subscription' && request.method === 'POST') {
    return handleAdminTransferSubscription(request, env, cors);
  }

  return Response.json(
    { error: 'Not found', service: 'vmp-billing' },
    { status: 404, headers: cors },
  );
}

export class BillingService extends WorkerEntrypoint<BillingWorkerEnv> {
  async fetch(request: Request): Promise<Response> {
    return routeBillingRequest(request, this.env, this.ctx);
  }

  async hasSubscription(userId: string): Promise<{ active: boolean; source: PspSource | null }> {
    return (await createBillingMiddleware(this.env)).hasSubscription(userId);
  }

  async getSubscription(userId: string): Promise<SubscriptionRecord | null> {
    return (await createBillingMiddleware(this.env)).getSubscription(userId);
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult> {
    return (await createBillingMiddleware(this.env)).createSubscription(params);
  }

  async cancelSubscription(
    userId: string,
    source: PspSource,
  ): Promise<CancelSubscriptionResult> {
    return (await createBillingMiddleware(this.env)).cancelSubscription(userId, source);
  }

  /**
   * Account-deletion path: immediately cancel all active PSP subscriptions for a user
   * and mark D1 rows cancelled. Returns a structured result so unsupported cancellation
   * survives the service-binding RPC boundary (Error `.code` may not).
   */
  async cancelSubscriptionImmediately(
    userId: string,
  ): Promise<
    | { ok: true; cancelled: number }
    | { ok: false; code: 'immediate_cancel_unsupported'; message: string }
  > {
    const db = this.env.video_subscription_db || this.env.DB;
    if (!db) throw new Error('D1 binding not found');
    const subs = await db
      .prepare(
        `
        SELECT id, provider, provider_subscription_id, stripe_subscription_id, status
        FROM subscriptions
        WHERE user_id = ?
          AND status IN ('active', 'trialing', 'past_due')
      `,
      )
      .bind(userId)
      .all();
    const rows = subs?.results ?? [];
    if (!rows.length) return { ok: true, cancelled: 0 };

    const { providers } = await getPaymentProviders(this.env);
    let cancelled = 0;
    for (const row of rows) {
      const rawProvider = String(row.provider || 'stripe').trim() || 'stripe';
      const providerId = (
        rawProvider === 'legacy' ? 'qerko' : rawProvider
      ) as PaymentProviderId;
      const provider = providers.get(providerId);
      const subId =
        String(row.provider_subscription_id || '').trim() ||
        String(row.stripe_subscription_id || '').trim();
      if (!provider || !subId || provider.capabilities.immediateCancellation !== true) {
        return {
          ok: false,
          code: 'immediate_cancel_unsupported',
          message:
            `Provider ${providerId} does not support immediate cancellation` +
            (!subId ? ' (missing provider subscription id)' : ''),
        };
      }
      await provider.cancelSubscriptionImmediately(subId);
      await db
        .prepare(
          `
          UPDATE subscriptions
          SET status = 'cancelled', cancel_at_period_end = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        )
        .bind(row.id)
        .run();
      cancelled += 1;
    }
    return { ok: true, cancelled };
  }

  async selectPspForNewSubscription(input: {
    billingCountry?: string | null;
    existingSource?: PspSource | null;
  }): Promise<PspSource> {
    return (await createBillingMiddleware(this.env)).selectPspForNewSubscription(input);
  }
}

export default {
  async fetch(
    request: Request,
    env: BillingWorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return routeBillingRequest(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: BillingWorkerEnv, ctx: ExecutionContext) {
    ctx.waitUntil(
      runComgateRenewalJobs(env).catch((err) => {
        console.error('billing Comgate renewal failed:', err);
      }),
    );
  },
};
