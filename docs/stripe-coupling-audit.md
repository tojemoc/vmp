# Stripe Coupling Audit — Gateway-Agnostic Roadmap

> Context: The payment registry (`@vmp/payments`) already defines a `PaymentProvider` interface
> and supports Stripe + Qerko (with GoPay/Comgate stubs). However many features remain
> tightly bound to Stripe APIs, Stripe-specific DB columns, and the Stripe JS SDK.
> This document tracks what needs to change so each feature can work with **any** configured
> provider and all providers can eventually be turned off independently.

## Severity Legend

| Level | Meaning |
|-------|---------|
| 🔴 Major | Feature cannot function with a non-Stripe provider; significant design/rework |
| 🟠 Medium | Provider-specific references that can be abstracted with moderate effort |
| 🟢 Low | Already isolated or trivial to rename/add parallel paths |

---

## 1. Webhook Processing 🔴

**Files:** `packages/api/src/paymentProcessor.ts` (`handleWebhook`, lines ~905-1106)

- Reads `Stripe-Signature` header directly.
- Parses raw Stripe event JSON (event types: `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
  `invoice.payment_failed`).
- Calls `stripeGet('/subscriptions/...')` to fetch full subscription objects.
- Calls `upsertStripeSubscription()` which reads Stripe-specific nested fields
  (`items.data[0].price.id`, `customer`, etc.).

**Gap:** `PaymentProvider.handleWebhook()` exists on the interface but the main handler
bypasses it — events are never normalized before processing.

**To universalize:**
- Route incoming webhooks to the correct provider's `handleWebhook()`.
- Consume only `NormalizedPaymentEvent` in the orchestration layer.
- Per-provider webhook endpoints or signature-based dispatch.

---

## 2. Checkout UI 🔴

**Files:**
- `packages/web/components/StripeEmbeddedCheckout.vue` (428 lines)
- `packages/web/components/SubscriptionCheckoutPanel.vue` (668 lines)
- `packages/web/composables/useStripeCheckoutReturn.ts`
- Dependency: `@stripe/stripe-js`

- `StripeEmbeddedCheckout` uses `loadStripe()` + Stripe Elements (`PaymentElement`,
  `ExpressCheckoutElement`) with wallet detection.
- `SubscriptionCheckoutPanel` hardcodes `provider: 'stripe'` in promo validation
  and login redirect params.
- `useStripeCheckoutReturn` checks for `session_id=cs_*` (Stripe-specific).

**To universalize:**
- Per-provider checkout component slot or a redirect-based flow (most gateways use redirect).
- Generic return-URL handling (Stripe uses `session_id`, Qerko uses `legacy_order`, others TBD).
- The Stripe JS SDK remains Stripe-internal; other providers use redirect or their own SDK.

---

## 3. Database Schema 🟠

**Migrations:** `0001`, `0010`, `0012`, `0044`

| Table | Stripe-specific columns |
|-------|------------------------|
| `subscriptions` | `stripe_subscription_id`, `stripe_customer_id` |
| `promo_codes` | `stripe_coupon_id` |
| `einvoices` | `stripe_invoice_id`, `stripe_payment_intent_id`, `stripe_subscription_id` |

Generic columns already exist (`provider`, `provider_subscription_id`,
`provider_customer_id`) but ~6 files still query `stripe_*` columns.

**To universalize:**
- Deprecate `stripe_*` columns; migrate remaining queries to `provider_*`.
- Add `provider_coupon_id` or a per-provider coupon mapping table.
- `einvoices` can keep Stripe IDs for provenance but invoice creation should work from
  normalized payment event data.

---

## 4. E-Invoicing 🔴

**Files:** `packages/api/src/eInvoicing.ts`, `migrations/0044_einvoicing.sql`

- `handleStripeInvoicePaid()` — triggered exclusively from Stripe `invoice.paid` webhook.
- `extractBuyerFromStripeInvoice()` — parses Stripe invoice object for buyer details.
- `buildLineItemsFromStripeInvoice()` — reads Stripe `lines.data` array.
- `createInvoiceFromStripe()` — entry point.

**To universalize:**
- Define a `NormalizedInvoiceEvent` with buyer, items, totals.
- Each provider extracts that from their own payment confirmation event.
- The e-invoice builder works from the normalized structure.

---

## 5. Promo/Coupons System 🟠

**Files:** `packages/api/src/promotions.ts`, `promo_codes` table

- `PromoProvider` type = `'stripe'` only.
- `stripe_coupon_id` required for discount-percent promos.
- `resolvePromoCodeForCheckout()` only resolves when `provider = 'stripe'`.
- Free month/year promos are already provider-agnostic (just grant access directly).

**To universalize:**
- Add `provider_coupon_ids: Record<ProviderId, string>` per promo code.
- Allow `resolvePromoCodeForCheckout()` to accept any provider and return the relevant
  coupon reference (or `null` if that provider doesn't support coupons).

---

## 6. Billing / Customer Portal 🟠

**Files:** `packages/api/src/paymentProcessor.ts` (`handlePortal`, lines ~1167-1230)

- Queries `stripe_customer_id` and creates Stripe Billing Portal session.
- Falls back to `legacy_manage_subscription_url` for non-Stripe providers.

**To universalize:**
- Each provider should expose a `getManageUrl(customerId)` method (or `null`).
- Portal handler calls the active provider; Stripe returns portal URL, Qerko returns
  their app URL, others return `null` → show in-app cancel UI.

---

## 7. Stripe Config / Client SDK 🟠

**Files:**
- `packages/api/src/paymentProcessor.ts` (`handleGetStripeConfig`)
- `packages/api/src/index.ts` (route)
- `packages/api/wrangler.json` (`STRIPE_PUBLISHABLE_KEY`)

- Dedicated `/api/payments/stripe-config` endpoint.
- Only relevant when Stripe checkout is mounted on the frontend.

**To universalize:**
- Make endpoint generic: `/api/payments/provider-config?provider=stripe` → returns
  provider-specific client keys/config. Each provider can opt in.

---

## 8. Admin Plan / Price Configuration 🟠

**Files:** `packages/api/src/paymentProcessor.ts`, `packages/api/src/paymentProviders.ts`,
`packages/api/src/settingsStore.ts`

- `stripe_price_{plan}` admin_settings keys map plans → Stripe price IDs.
- `resolvePlanType()` matches incoming Stripe price IDs against stored settings.
- Settings TTL cache has Stripe-prefixed key special-casing.

**To universalize:**
- Store price references as `{provider}_{plan}_price_id` (already partially done for
  Stripe; needs pattern for other providers).
- Plan-to-amount resolution is already provider-agnostic via `{plan}_price_eur`.

---

## 9. Newsletter / Brevo Sync 🟢

**Files:** `packages/api/src/brevo.ts`

- `syncNewsletterForStripeSubscription()` — name is Stripe-specific but the function
  accepts a normalized status string and has no Stripe API calls.

**To universalize:** Rename to `syncNewsletterForSubscription()`. Already effectively
provider-agnostic (called from legacy webhook path too).

---

## 10. Locales & Privacy Text 🟢

**Files:** `packages/web/locales/*/strings.ts`, `personalData.ts`

- 7 `checkoutStripe*` locale keys.
- "Stripe" mentioned as a third-party data processor in privacy text.

**To universalize:** Add parallel keys per provider; make processor list dynamic from
enabled providers.

---

## 11. Replication / Backup API 🟢

**Files:** `packages/api/src/replication.ts`, `packages/api-node/`

- Replicates `stripe_*` columns. Follows DB schema changes automatically.

---

## Priority Order for Universalizing

1. **Webhook normalization** — route all payment events through `PaymentProvider.handleWebhook()` → `NormalizedPaymentEvent`. Biggest impact, unblocks everything else.
2. **DB schema migration** — deprecate `stripe_*` query paths in favor of `provider_*`.
3. **E-invoicing abstraction** — define `NormalizedInvoiceEvent`; provider-specific extractors.
4. **Checkout UI** — per-provider checkout slots (Stripe keeps Elements; others use redirect).
5. **Billing portal** — `PaymentProvider.getManageUrl()`.
6. **Promo coupons** — per-provider coupon ID mapping.
7. **Rename / cosmetic** — locale keys, function names, privacy text.
