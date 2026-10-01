/**
 * In-billing composition root — always local (this package IS the billing Worker).
 */
import type { PaymentMiddleware } from '@vmp/payments';
import { createBillingMiddleware, type BillingWorkerEnv } from './compose.js';

export type BillingEnv = BillingWorkerEnv;

export async function getBillingMiddleware(env: BillingEnv): Promise<PaymentMiddleware> {
  return createBillingMiddleware(env);
}
