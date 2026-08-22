/** Customer-safe message when bank/legacy checkout is misconfigured or unavailable. */
export const CUSTOMER_SAFE_BANK_PAYMENTS_UNAVAILABLE =
  'Bank payments are temporarily unavailable. Please choose another payment method or try again later.';

/** Detect server messages that would leak env var names or internal config details. */
export function looksLikePaymentConfigLeak(message: string): boolean {
  return /not configured|LEGACY_[A-Z0-9_]+|API[_ ]?URL|FRONTEND_URL|misconfigured/i.test(
    message,
  );
}

export function customerSafeLegacyNotConfiguredResponse(): {
  error: string;
  code: 'legacy_not_configured';
  status: 503;
} {
  return {
    error: CUSTOMER_SAFE_BANK_PAYMENTS_UNAVAILABLE,
    code: 'legacy_not_configured',
    status: 503,
  };
}

export function throwLegacyNotConfiguredError(): never {
  const err = new Error(CUSTOMER_SAFE_BANK_PAYMENTS_UNAVAILABLE) as Error & {
    code?: string;
    status?: number;
  };
  err.code = 'legacy_not_configured';
  err.status = 503;
  throw err;
}
