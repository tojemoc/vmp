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

## 1. Webhook Processing 🟢

**Status:** Normalized in this PR — `handleWebhook` consumes `PaymentProvider.handleWebhook()` → `NormalizedPaymentEvent`.

**Remaining:** Provider-specific enrichment (e.g. Stripe subscription fetch for planType) is isolated in `upsertSubscriptionFromNormalizedEvent`; new providers should populate `planType`, `status`, and `currentPeriodEnd` in their normalizer to avoid API round-trips.

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

## 4. E-Invoicing 🟢

**Status:** `NormalizedInvoiceData` on payment events + `createInvoiceFromPayment()` in `eInvoicing.ts`. Stripe extracts invoice fields in `@vmp/payments` (`normalizeStripeInvoice`).

**Remaining:** GoPay/Comgate/other providers must implement invoice extractors when they support recurring billing + e-invoicing.

---

## 5. Promo/Coupons System 🟠

**Files:** `packages/api/src/promotions.ts`, `promo_codes` table

**Current state (partially generalized):**
- `PromoProvider` type = `'stripe' | 'legacy'` (Qerko checkout uses `'legacy'`).
- `resolvePromoCodeForCheckout()` accepts any `PromoProvider`; free month/year promos
  are provider-agnostic.
- Discount-percent promos still require a Stripe coupon: the resolver returns
  `promo_provider_mapping_missing` when `provider !== 'stripe'` or when
  `stripe_coupon_id` is unset.

**To universalize:**
- Add `provider_coupon_ids: Record<ProviderId, string>` per promo code.
- Allow `resolvePromoCodeForCheckout()` to return a coupon reference for any
  provider that supports percentage discounts (not Stripe-only).

---

## 6. Billing / Customer Portal 🟢

**Status:** Optional `PaymentProvider.getManageUrl()`. Portal handler uses provider registry + `provider_customer_id` (falls back to legacy `stripe_customer_id`).

**Remaining:** GoPay/Comgate branches should implement `getManageUrl` when those providers ship.

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

- Renamed to `syncNewsletterForSubscription()` (Stripe-specific alias kept deprecated).

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

1. ~~**Webhook normalization**~~ — done (`NormalizedPaymentEvent` orchestration).
2. **DB schema migration** — deprecate `stripe_*` query paths in favor of `provider_*` (portal/subscription lookups partially migrated).
3. ~~**E-invoicing abstraction**~~ — done (`NormalizedInvoiceData` + `createInvoiceFromPayment`).
4. **Checkout UI** — per-provider checkout slots (Stripe keeps Elements; others use redirect).
5. ~~**Billing portal**~~ — done (`PaymentProvider.getManageUrl()`).
6. **Promo coupons** — per-provider coupon ID mapping (`provider_coupon_ids` JSON column).
7. **Rename / cosmetic** — locale keys, privacy text.

### Coordination with provider PRs (e.g. `cursor/gopay-payment-provider-draft-1946`)

Merge **abstraction PR first** when possible. Provider branches should only add:

- Registry entries + `createGoPayProvider` / `createComgateProvider` implementations
- Provider-specific webhook normalizers (including `invoice` when applicable)
- Optional `getManageUrl` for hosted manage flows
- Admin UI toggles for new gateway IDs

Avoid re-implementing orchestration in provider PRs — extend `@vmp/payments` types and plug into existing API handlers.
