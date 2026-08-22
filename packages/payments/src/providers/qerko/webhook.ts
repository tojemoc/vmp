import type { NormalizedPaymentEvent, PlanType } from '../../types.js';

/** Parse a Qerko (legacy eshop) webhook JSON body into a normalized payment event. */
export function parseQerkoWebhookPayload(payload: Record<string, unknown>): NormalizedPaymentEvent {
  const subscription =
    payload.subscription && typeof payload.subscription === 'object'
      ? payload.subscription
      : null;
  const cardOnFile = String(
    (subscription as { cardOnFile?: unknown } | null)?.cardOnFile ?? payload.cardOnFile ?? '',
  ).trim();
  const purchaseId = String(
    payload.purchaseId ?? payload.purchase_id ?? cardOnFile ?? '',
  ).trim();
  const providerOrderId = String(payload.idOrder ?? payload.orderId ?? '').trim();
  const status = String(payload.status ?? payload.subscriptionStatus ?? '').trim();
  const normalizedStatus = status.toLowerCase();
  let type: NormalizedPaymentEvent['type'] = 'subscription.updated';
  if (
    normalizedStatus === 'cancelled' ||
    normalizedStatus === 'canceled' ||
    normalizedStatus === 'deleted'
  ) {
    type = 'subscription.deleted';
  } else if (normalizedStatus === 'past_due' || normalizedStatus === 'past-due') {
    type = 'subscription.past_due';
  }

  return {
    type,
    providerId: 'qerko',
    purchaseId,
    ...(providerOrderId ? { providerOrderId } : {}),
    ...(cardOnFile ? { subscriptionId: cardOnFile } : {}),
    planType: String(payload.planType ?? 'monthly') as PlanType,
    status,
    currentPeriodEnd: payload.currentPeriodEnd ?? payload.current_period_end ?? null,
    raw: payload,
  };
}
