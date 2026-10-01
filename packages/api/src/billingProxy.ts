/**
 * Forward billing HTTP to the `@vmp/billing` Worker via service binding.
 * Keeps public API_URL webhook/checkout paths stable while billing owns the logic.
 */

const BILLING_PATH_PREFIXES = [
  '/api/payments',
  '/api/account/pricing',
  '/api/account/subscription',
  '/api/account/invoices',
  '/api/account/promotions',
  '/api/account/isic',
  '/api/account/transfer-subscription',
  '/api/admin/payments',
  '/api/admin/legacy-migration',
  '/api/admin/einvoicing',
  '/api/admin/promotions',
  '/api/admin/isic',
  '/api/admin/users/transfer-subscription',
] as const;

export function isBillingProxyPath(pathname: string): boolean {
  return BILLING_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

type BillingFetchBinding = {
  fetch: (request: Request) => Promise<Response>;
};

export async function proxyToBilling(
  request: Request,
  env: { BILLING?: BillingFetchBinding },
  corsHeaders: Record<string, string> = {},
): Promise<Response> {
  const billing = env.BILLING;
  if (!billing || typeof billing.fetch !== 'function') {
    return new Response(
      JSON.stringify({
        error: 'Billing service unavailable',
        code: 'billing_not_bound',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      },
    );
  }
  const upstream = await billing.fetch(request);
  const headers = new Headers(upstream.headers);
  for (const name of [
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Credentials',
    'Access-Control-Expose-Headers',
    'Access-Control-Allow-Methods',
    'Access-Control-Allow-Headers',
    'Access-Control-Max-Age',
  ]) {
    headers.delete(name);
  }
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
