# GoPay + Comgate payment providers

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) → *GoPay + Comgate* (`payments-gopay-comgate`)  
**Issue:** [#648](https://github.com/tojemoc/vmp/issues/648) / [TOJ-141](https://linear.app/tojemoc/issue/TOJ-141)

## Status

Providers + checkout analytics + **production code hardening** shipped. **Live merchant smoke remains maintainer ops** (same pattern as Brevo step-08).

Shipped providers: [#499](https://github.com/tojemoc/vmp/pull/499), analytics [#654](https://github.com/tojemoc/vmp/pull/654). Hardening on branch `cursor/gopay-comgate-prod-hardening-a164`.

## Checklist

- [x] Provider registry + admin pricing ([#499](https://github.com/tojemoc/vmp/pull/499))
- [x] Comgate first-checkout identity + renewals ([#499](https://github.com/tojemoc/vmp/pull/499))
- [x] GoPay redirect checkout + recurrence ([#499](https://github.com/tojemoc/vmp/pull/499))
- [x] Qerko legacy club → `subscriptionType: club` ([#499](https://github.com/tojemoc/vmp/pull/499))
- [x] Checkout analytics for GoPay + Comgate start/return ([#654](https://github.com/tojemoc/vmp/pull/654))
- [x] Production code hardening (timing-safe Comgate secret, idempotent cancel, invoice normalize + webhook e-invoice hook, paid-amount verify, sandbox/prod API-base guard, self-service cancel-at-period-end)
- [ ] Live merchant smoke + maintainer sign-off (ops — not a code blocker)

## Production hardening (code)

| Area | Behaviour |
|------|-----------|
| Comgate webhook secret | Constant-time compare (no `===` on secrets) |
| Cancel | `POST /api/payments/cancel` voids GoPay recurrence / Comgate recurring and sets `cancel_at_period_end`; provider cancel is idempotent |
| E-invoicing | Paid GoPay/Comgate events carry `NormalizedInvoiceData`; webhooks call `handlePaymentInvoicePaid` |
| Amount integrity | Webhook handlers reject paid events whose amount/currency do not match configured plan price |
| GoPay API base | Checkout fails closed when `FRONTEND_URL` is non-local and `GOPAY_API_BASE` still points at sandbox |
| Admin UI | Providers labeled production-ready; sandbox API base shows an amber warning |

## Maintainer live smoke (staging / production)

1. Set secrets: `GOPAY_CLIENT_ID` / `GOPAY_CLIENT_SECRET` / `GOPAY_GOID` with **`GOPAY_API_BASE=https://gate.gopay.cz/api`** (or Comgate merchant + secret).
2. Enable provider in Admin → Payment plans; set CZK plan prices.
3. Complete one real (or sandbox-with-explicit-base) checkout → webhook activates subscription → PostHog `subscription_checkout_*` events fire.
4. Cancel from Account → subscription stays active until period end; Comgate cron / GoPay recurrence does not renew.
5. Confirm e-invoice row when `einvoicing_enabled=1` (or `not_required` when disabled).

## Out of scope (other roadmap items)

- `cancelSubscriptionImmediately` for account deletion → [`step-10`](step-10-account-deletion.md) / [#646](https://github.com/tojemoc/vmp/issues/646)
- Native Apple/Google Pay one-click (impossible outside hosted gateway — documented in `@vmp/payments` README)
