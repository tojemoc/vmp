export { NotImplementedError } from './errors.js';
export * from './ids.js';
export { createComgateProvider } from './providers/comgate/index.js';
export { createGoPayProvider } from './providers/gopay/index.js';
export { createQerkoProvider } from './providers/qerko/index.js';
export { parseQerkoWebhookPayload } from './providers/qerko/webhook.js';
export { normalizeRedirectGatewayInvoice } from './providers/redirectInvoice.js';
export { createStripeProvider } from './providers/stripe/index.js';
export { normalizeStripeInvoice } from './providers/stripe/invoice.js';
export * from './registry.js';
export { timingSafeEqualString } from './timingSafe.js';
export * from './types.js';

export const GOPAY_SANDBOX_API_BASE = 'https://gw.sandbox.gopay.com/api';
export const GOPAY_PRODUCTION_API_BASE = 'https://gate.gopay.cz/api';

export function isGoPaySandboxApiBase(apiBase: string | null | undefined): boolean {
  const raw = String(apiBase ?? '').trim();
  if (!raw) return true;
  try {
    const hostname = new URL(raw).hostname.toLowerCase();
    return hostname === 'sandbox.gopay.com' || hostname.endsWith('.sandbox.gopay.com');
  } catch {
    return false;
  }
}
