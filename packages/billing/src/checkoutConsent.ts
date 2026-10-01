/**
 * Checkout terms / withdrawal consent persistence (step 10).
 *
 * Stores an immutable record of the statutory digital-content acknowledgment
 * accepted at checkout time — not a blanket no-refund waiver.
 */

import { CHECKOUT_CONSENT_VERSION } from '@vmp/shared';

/** Canonical English wording persisted with each consent row. */
export const CHECKOUT_CONSENT_TEXT =
  'I acknowledge that digital content access begins immediately upon payment and that, where applicable law permits for immediately delivered digital content/services, I waive the 14-day withdrawal right under EU consumer rules as implemented in CZ/SK law. Mandatory remedies for non-conforming delivery remain.';

export function generateCheckoutConsentId(): string {
  return crypto.randomUUID();
}

/** First 8 hex chars of SHA-256 — enough to distinguish admin override wording. */
export async function shortConsentTextHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8);
}

/**
 * Version id for a consent row. Default canonical text keeps `CHECKOUT_CONSENT_VERSION`;
 * admin overrides append a short hash so audits can tell which wording was shown.
 */
export async function resolveCheckoutConsentVersion(consentText?: string | null): Promise<string> {
  const override = typeof consentText === 'string' ? consentText.trim() : '';
  if (!override) return CHECKOUT_CONSENT_VERSION;
  const hash = await shortConsentTextHash(override);
  return `${CHECKOUT_CONSENT_VERSION}:${hash}`;
}

export async function persistCheckoutConsent(
  db: any,
  params: {
    userId: string;
    provider: string;
    checkoutSessionId?: string | null;
    providerSessionId?: string | null;
    subscriptionId?: string | null;
    consentVersion?: string;
    consentText?: string;
  },
): Promise<string> {
  const id = generateCheckoutConsentId();
  const version = params.consentVersion ?? CHECKOUT_CONSENT_VERSION;
  const text = params.consentText ?? CHECKOUT_CONSENT_TEXT;
  await db
    .prepare(
      `INSERT INTO checkout_consents (
         id, user_id, provider, consent_version, consent_text,
         checkout_session_id, provider_session_id, subscription_id, accepted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      params.userId,
      params.provider,
      version,
      text,
      params.checkoutSessionId ?? null,
      params.providerSessionId ?? null,
      params.subscriptionId ?? null,
    )
    .run();
  return id;
}

/**
 * Attach a subscription id to the most recent consent for this user+provider
 * that still lacks one (webhook path after checkout completes).
 */
export async function linkCheckoutConsentSubscription(
  db: any,
  params: {
    userId: string;
    provider: string;
    subscriptionId: string;
    providerSessionId?: string | null;
  },
): Promise<void> {
  if (params.providerSessionId) {
    await db
      .prepare(
        `UPDATE checkout_consents
         SET subscription_id = ?
         WHERE user_id = ?
           AND provider = ?
           AND provider_session_id = ?
           AND (subscription_id IS NULL OR subscription_id = '')`,
      )
      .bind(params.subscriptionId, params.userId, params.provider, params.providerSessionId)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE checkout_consents
       SET subscription_id = ?
       WHERE id = (
         SELECT id FROM checkout_consents
         WHERE user_id = ? AND provider = ?
           AND (subscription_id IS NULL OR subscription_id = '')
         ORDER BY accepted_at DESC
         LIMIT 1
       )`,
    )
    .bind(params.subscriptionId, params.userId, params.provider)
    .run();
}
