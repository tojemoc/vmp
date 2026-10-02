/**
 * Billing Worker readiness — boolean secret presence only (no values).
 * Used by `/api/health` and CD smoke so missing Phase-F secrets fail loudly.
 */

export type BillingSecretName =
  | 'JWT_SECRET'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'STRIPE_PUBLISHABLE_KEY'
  | 'BREVO_API_KEY'
  | 'PEPPOL_AP_API_KEY';

/**
 * Required for authenticated billing routes + Stripe checkout.
 * `STRIPE_PUBLISHABLE_KEY` is usually a wrangler var (not `secret put`) but is
 * still required for Embedded Checkout / stripe-config.
 */
export const REQUIRED_BILLING_SECRETS: readonly BillingSecretName[] = [
  'JWT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PUBLISHABLE_KEY',
] as const;

export type BillingReadiness = {
  service: 'vmp-billing';
  ok: true;
  /** True when JWT + Stripe secret/webhook/publishable keys are all set. */
  ready: boolean;
  secrets: Record<BillingSecretName, boolean>;
  providers: {
    stripeSecretConfigured: boolean;
    stripePublishableConfigured: boolean;
  };
  missingRequired: BillingSecretName[];
};

function secretPresent(env: Record<string, unknown>, name: BillingSecretName): boolean {
  return Boolean(String(env[name] ?? '').trim());
}

export function getBillingReadiness(env: Record<string, unknown>): BillingReadiness {
  const secrets: Record<BillingSecretName, boolean> = {
    JWT_SECRET: secretPresent(env, 'JWT_SECRET'),
    STRIPE_SECRET_KEY: secretPresent(env, 'STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: secretPresent(env, 'STRIPE_WEBHOOK_SECRET'),
    STRIPE_PUBLISHABLE_KEY: secretPresent(env, 'STRIPE_PUBLISHABLE_KEY'),
    BREVO_API_KEY: secretPresent(env, 'BREVO_API_KEY'),
    PEPPOL_AP_API_KEY: secretPresent(env, 'PEPPOL_AP_API_KEY'),
  };
  const missingRequired = REQUIRED_BILLING_SECRETS.filter((name) => !secrets[name]);
  return {
    service: 'vmp-billing',
    ok: true,
    ready: missingRequired.length === 0,
    secrets,
    providers: {
      stripeSecretConfigured: secrets.STRIPE_SECRET_KEY,
      stripePublishableConfigured: secrets.STRIPE_PUBLISHABLE_KEY,
    },
    missingRequired,
  };
}
