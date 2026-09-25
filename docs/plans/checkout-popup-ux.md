# Checkout popup UX (`checkout-popup-ux`)

**Issue:** [#712](https://github.com/tojemoc/vmp/issues/712)  
**Roadmap:** [ROADMAP.md](../../ROADMAP.md) → Checkout popup UX

## Goals

1. **Fast prices** — `GET /api/account/pricing` must not fan out into dozens of per-key D1 reads; batch via `getSettings`.
2. **Inline auth** — unauthenticated checkout collects email → email confirmation code → optional TOTP, then continues to payment in the same panel (no `/login` round-trip).
3. **Less clutter** — hide promo UI when promotions are off; never block Stripe with “Promo codes are currently disabled” when no code was entered; drop newsletter opt-out from checkout; soft-pedal bank CTAs/errors; make legal + trust copy editable in admin.

## Non-goals

- Rewriting the auth module (extend magic-link tokens with an OTP hash; keep link flow).
- Removing legal consent checkbox (keep affirmative consent; make wording admin-editable).
- Changing Stripe Embedded Checkout architecture.

## API

### Pricing

- `handleGetPricing` loads all needed keys in **one** `getSettings` call.
- Response adds:
  - `promotionsEnabled: boolean`
  - `checkoutCopy: { termsAcceptLabel?: string; trustBlurb?: string }` (empty → client locale defaults)

### Promo resolution bug

`resolvePromoCodeForCheckout` must treat **empty / missing** promo as `reason: 'empty'` even when `promotions_enabled=0`, so Stripe checkout sessions create normally.

### Magic-link OTP

- Migration: `magic_link_tokens.otp_hash TEXT` (nullable; indexed).
- On magic-link create: also mint a 6-digit OTP, store `otp_hash`, include code in Brevo email (and `[DEV]` log).
- `POST /api/auth/verify-code` body `{ email, code }` → same session / TOTP-pending outcomes as `GET /api/auth/verify`.
- Rate-limit verify-code attempts (reuse magic-link throttle fingerprinting where practical).

### Admin copy

Stored in `admin_settings`:

| Key | Purpose |
|-----|---------|
| `checkout_terms_accept_label` | Checkbox label (locale default if empty) |
| `checkout_trust_blurb` | Footer trust line under payment methods |

Editable from Admin → Payment plans (or System branding-adjacent section). Persisted consent rows continue to use `CHECKOUT_CONSENT_TEXT` / version from `@vmp/shared` unless the admin override is present at checkout time (store the effective text shown).

## Frontend

`SubscriptionCheckoutPanel`:

- Show inline auth steps when `!isLoggedIn`.
- Hide newsletter opt-out (account page only).
- Promo block only if `promotionsEnabled`; collapsed behind “Have a promo code?” until expanded.
- Prefer Stripe; tuck legacy/GoPay/Comgate under secondary actions; clearer bank label (no “pay €X from bank account” ambiguity).
- Use `checkoutCopy` overrides when non-empty.
- Clear provider/promo red errors when switching plan or when Stripe is healthy.

## Tests

- Promo disabled + empty code → checkout path treats as empty.
- Pricing handler uses batched settings (unit-level on helpers / response shape).
- OTP verify happy path + wrong code + TOTP pending (auth tests).
