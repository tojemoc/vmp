# GoCardless checkout — outbound API payloads

VMP does **not** use the [gocardless-nodejs](https://github.com/gocardless/gocardless-nodejs) SDK. The Cloudflare Worker calls the REST API with `fetch` (see `packages/api/src/gocardlessCore.ts`), same pattern as Stripe in `stripeClient.ts`.

Entry points:

| Handler | Route | When |
|---------|-------|------|
| `handleCheckout` | `POST /api/payments/checkout` | User starts GoCardless checkout |
| `handleGoCardlessComplete` | `POST /api/payments/gocardless/complete` | User returns from hosted flow |
| `handleGoCardlessWebhook` | `POST /api/payments/webhook/gocardless` | GoCardless subscription events |

Payload builders: `buildGoCardlessMandateBillingRequestPayload`, `buildGoCardlessBillingRequestFlowCreatePayload` in `gocardlessCore.ts`.

---

## HTTP headers (all GoCardless calls)

```http
Authorization: Bearer <GOCARDLESS_ACCESS_TOKEN>
Content-Type: application/json
GoCardless-Version: 2015-07-06
```

Base URL: `https://api.gocardless.com`

Optional:

```http
Idempotency-Key: <checkoutToken>
```

Used on `POST /subscriptions` and `POST /billing_requests/{id}/actions/fulfil`.

---

## 1. Create billing request — `POST /billing_requests`

Triggered by `POST /api/payments/checkout` when `provider` is `gocardless`.

### JSON body

```json
{
  "billing_requests": {
    "mandate_request": {
      "currency": "EUR"
    },
    "metadata": {
      "userId": "<jwt sub>",
      "planType": "monthly",
      "checkoutToken": "<uuid>"
    },
    "links": {
      "creditor": "<GOCARDLESS_CREDITOR_ID>"
    }
  }
}
```

### Field sources

| Field | Source |
|-------|--------|
| `mandate_request.currency` | `admin_settings.gocardless_currency` via `normalizeGoCardlessCurrency()` (default `EUR`) |
| `metadata.userId` | Authenticated user id (`user.sub` from JWT) |
| `metadata.planType` | Checkout body `planType`: `monthly`, `yearly`, or `club` |
| `metadata.checkoutToken` | New `crypto.randomUUID()` per attempt; also stored on `payment_checkout_sessions.checkout_token` |
| `links.creditor` | Wrangler secret `GOCARDLESS_CREDITOR_ID` (omitted if empty) |

### Metadata limit (important)

GoCardless allows **at most 3 keys** on `billing_requests.metadata`. Do not add a fourth key (e.g. `currency`); currency belongs on `mandate_request.currency` and in D1 as `payment_checkout_sessions.gocardless_currency_snapshot`.

`buildGoCardlessMandateBillingRequestPayload` throws if metadata has more than three keys.

### D1 row before this call

A `payment_checkout_sessions` row is inserted with `status = pending` and `gocardless_currency_snapshot` set. If this API call fails, `provider_checkout_id` and `session_token` stay `NULL` (orphaned pending row).

---

## 2. Create billing request flow — `POST /billing_request_flows`

Runs immediately after a successful billing request.

### JSON body

```json
{
  "billing_request_flows": {
    "auto_fulfil": true,
    "redirect_uri": "https://<FRONTEND_URL>/account?gocardless_checkout_token=<checkoutToken>",
    "exit_uri": "https://<FRONTEND_URL>/pricing",
    "lock_currency": true,
    "links": {
      "billing_request": "<billing request id from step 1>"
    },
    "prefilled_customer": {
      "email": "<user email>"
    }
  }
}
```

### Field sources

| Field | Source |
|-------|--------|
| `auto_fulfil` | Always `true` |
| `redirect_uri` | `env.FRONTEND_URL` + query `gocardless_checkout_token` |
| `exit_uri` | `FRONTEND_URL/pricing` |
| `lock_currency` | Always `true` (payer cannot change currency on hosted flow) |
| `links.billing_request` | Id from step 1 response (`billing_requests.id`) |
| `prefilled_customer.email` | User email from JWT; property omitted if email is empty |

### Response usage

- `billing_request_flows.authorisation_url` → returned to the client as `checkoutUrl`.
- Session row updated: `provider_checkout_id` = flow id, `session_token` = billing request id.

---

## 3. Create subscription — `POST /subscriptions`

Triggered by `POST /api/payments/gocardless/complete` after the customer authorises the mandate (billing request fulfilled).

### JSON body

```json
{
  "subscriptions": {
    "amount": 999,
    "currency": "EUR",
    "name": "VMP Monthly",
    "interval": 1,
    "interval_unit": "monthly",
    "day_of_month": 1,
    "links": {
      "mandate": "<mandate id>"
    },
    "metadata": {
      "userId": "<jwt sub>",
      "planType": "monthly",
      "checkoutToken": "<same token as checkout>"
    }
  }
}
```

### Field sources

| Field | Source |
|-------|--------|
| `amount` | Plan price in **minor units** (`moneyToMinorUnits`: EUR × 100) from `gocardless_monthly_price_eur` / `yearly` / `club` admin settings |
| `currency` | `payment_checkout_sessions.gocardless_currency_snapshot`, else `gocardless_currency` admin setting |
| `name` | Promo snapshot `gocardless_plan_code_snapshot`, else `gocardless_plan_<planType>` admin setting |
| `interval` / `interval_unit` | `monthly` → `1` + `monthly`; `yearly` and `club` → `1` + `yearly` |
| `day_of_month` | Always `1` |
| `links.mandate` | Mandate id from fulfilled billing request |
| `metadata` | Same three keys as billing request (within GoCardless limits) |

Headers: `Idempotency-Key: <checkoutToken>`.

---

## Other GoCardless calls

| Method | Path | Body | Used by |
|--------|------|------|---------|
| `GET` | `/billing_requests/{id}` | — | `resolveFulfilledBillingRequestMandate` |
| `POST` | `/billing_requests/{id}/actions/fulfil` | `{}` | When status is `ready_to_fulfil` |
| `GET` | `/subscriptions/{id}` | — | `handleGoCardlessWebhook` |

---

## Configuration

### Wrangler secrets (`packages/api`)

```text
GOCARDLESS_ACCESS_TOKEN   — API access token (live or sandbox)
GOCARDLESS_CREDITOR_ID    — Creditor id (CR…) for the same environment as the token
GOCARDLESS_WEBHOOK_SECRET — Webhook signing secret
```

Checkout is only offered when **both** `GOCARDLESS_ACCESS_TOKEN` and `GOCARDLESS_CREDITOR_ID` are set (`getRunnableProviders` in `paymentProcessor.ts`).

### Admin settings (`admin_settings`)

| Key | Purpose |
|-----|---------|
| `payments_enabled_providers` | Must include `gocardless` |
| `payment_provider_order` | Checkout provider preference |
| `gocardless_currency` | Mandate/subscription currency (default EUR) |
| `gocardless_monthly_price_eur` | Plan amounts for subscription create |
| `gocardless_yearly_price_eur` | |
| `gocardless_club_price_eur` | |
| `gocardless_plan_monthly` / `yearly` / `club` | Subscription `name` fallback |
| `gocardless_manage_subscription_url` | Customer portal link (optional) |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `metadata`: “No more than 3 properties are allowed” | Fourth metadata key on billing request (fixed by keeping only `userId`, `planType`, `checkoutToken`) |
| `provider_checkout_id` NULL, `status` pending | `POST /billing_requests` or `/billing_request_flows` failed after D1 insert |
| `currency_doesnt_support_functionality` | Creditor does not support EUR/SEPA for mandates; check GoCardless dashboard |
| 401 / invalid token | `GOCARDLESS_ACCESS_TOKEN` missing, wrong environment, or rotated |

Worker log line to inspect: `GoCardless billing request error:` (full GoCardless JSON body).
