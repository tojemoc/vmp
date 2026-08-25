# @vmp/payments

Pluggable payment providers for VMP billing.

## Providers

| ID | Status | Default enabled |
|---|---|---|
| `stripe` | Production | Yes |
| `qerko` | Production (legacy eshop / migration) | Only when listed in tenant settings |
| `gopay` | **Draft** — redirect checkout + recurrence + notifications | No (enable via admin) |
| `comgate` | **Draft** — redirect checkout + initRecurring + webhooks | No (enable via admin) |

Admin settings still store `legacy` in CSV lists; the registry normalizes that to `qerko`. D1 `subscriptions.provider` continues to use `legacy` for Qerko rows and `gopay` for GoPay rows.

## Tenant configuration

`payments_enabled_providers` and `payment_provider_order` in `admin_settings` control which providers are active, e.g.:

- Fresh launch: `stripe`
- Migrated tenant: `stripe,legacy` (parsed as `stripe,qerko`)
- Draft GoPay alongside Stripe: `stripe,gopay`

`createEnabledProviders(enabledIds, config)` returns a `Map` of configured provider instances. Billing code must resolve the provider from this map — never import Stripe or Qerko SDKs directly.

### GoPay admin_settings (no hardcoded prices)

| Key | Purpose |
|---|---|
| `gopay_monthly_price` / `gopay_yearly_price` / `gopay_club_price` | Plan amounts in **major** units (e.g. `199` = 199 CZK) |
| `gopay_currency` | ISO currency, default `CZK` |

Worker secrets / vars:

| Name | Purpose |
|---|---|
| `GOPAY_CLIENT_ID` / `GOPAY_CLIENT_SECRET` | OAuth2 client credentials |
| `GOPAY_GOID` | Merchant goId |
| `GOPAY_API_BASE` | Optional; default sandbox `https://gw.sandbox.gopay.com/api` (prod: `https://gate.gopay.cz/api`) |
| `API_URL` | Used to build `notification_url` → `{API_URL}/api/payments/webhook/gopay` |

## Capabilities

Each provider exposes `capabilities`:

- `newSubscriptions` — may onboard brand-new subscribers (Qerko: **true** when enabled in tenant settings; uses the legacy eshop initial payment / CardOnFile create flow; GoPay/Comgate drafts: **true**)
- `migrationOnly` — only for pre-existing platform subscribers (Qerko: **false**; relink still works via `needs_relink` + purchaseId)
- `recurringPayments`, `refunds`, `webhooks` — feature flags for future UI/guards

Checkout must gate on `provider.capabilities.newSubscriptions` instead of hardcoded provider IDs. Admins still control whether Qerko appears at checkout via `payments_enabled_providers`.

## GoPay draft behaviour

1. **Checkout** — `POST /api/payments/payment` with automatic `recurrence` (`MONTH` / period 1 or 12). Returns `gw_url` for browser redirect (same UX pattern as legacy Qerko).
2. **Webhook** — GoPay sends **GET** `{notification_url}?id=&parent_id=`. The Worker re-fetches payment status with merchant credentials (notifications are **not** HMAC-signed).
3. **Cancel** — `POST .../void-recurrence` on the parent payment id stored as `provider_subscription_id`.
4. **Portal** — GoPay has no Stripe-style customer portal; `/api/payments/portal` returns `portal_not_supported` for GoPay subscriptions.

### One-click / Apple Pay / Google Pay limitations

From [GoPay docs](https://doc.gopay.cz/#android-a-ios) (also tracked in [#442](https://github.com/tojemoc/vmp/issues/442)):

- The payment gateway is a **web application only**.
- Apple Pay and Google Pay are available **only inside the hosted gateway**, not as native one-click dialogs from a mobile app.
- **Do not use WebView** (`WebView` / `WKWebView`) — wallet methods will not work. Use Chrome Custom Tabs / `SFSafariViewController` (or a normal browser redirect).

This draft therefore never promises native Apple/Google Pay; checkout always redirects to `gw_url`.

## Comgate draft behaviour

1. **Checkout** — `POST /api/payments/payment` creates a Comgate payment with `initRecurring=true` and returns a `redirect` URL. A pending row in `payment_checkout_sessions` (table from migration `0010_gocardless_payments.sql`; keyed by `refId` / `transId`) stores the user and plan until the webhook fires. Checkout fails closed if that row cannot be written.
2. **Webhook** — Comgate sends **POST** callbacks with a `secret` field. The Worker verifies the secret, re-fetches status via `/v1.0/status`, and resolves the paying user from the pending checkout session (first purchase) or an existing subscription row (renewals).
3. **Cancel** — `POST /v1.0/cancel` on the stored `provider_subscription_id` (Comgate `transId`).
4. **Failed renewal** — maps to `past_due` (same grace-period policy as GoPay), not immediate cancellation.

### Comgate admin_settings (no hardcoded prices)

| Key | Purpose |
|---|---|
| `comgate_monthly_price` / `comgate_yearly_price` / `comgate_club_price` | Plan amounts in **major** units (e.g. `199` = 199 CZK) |
| `comgate_currency` | ISO currency, default `CZK` |

Worker secrets / vars:

| Name | Purpose |
|---|---|
| `COMGATE_MERCHANT` / `COMGATE_SECRET` | Merchant credentials |
| `COMGATE_API_BASE` | Optional; default `https://payments.comgate.cz` |
| `COMGATE_COUNTRY` | Optional; default `CZ` |
| `API_URL` | Used to build webhook URL → `{API_URL}/api/payments/webhook/comgate` |

## Adding a provider

1. Add `src/providers/<id>/index.ts` exporting `createXProvider(config): PaymentProvider`.
2. Register in `src/registry.ts` `PROVIDER_FACTORIES`.
3. Wire config in the API composition root (`packages/api/src/paymentProviders.ts`).
4. Add webhook route `/api/payments/webhook/<id>` or dispatch by path.
5. For redirect providers without embeddable user metadata (Comgate), persist a pending `payment_checkout_sessions` row at checkout creation so webhooks can resolve the paying user.
