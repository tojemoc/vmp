# Checkout popup UX (`checkout-popup-ux`)

**Issue:** [#712](https://github.com/tojemoc/vmp/issues/712)  
**Roadmap:** [ROADMAP.md](../../ROADMAP.md) → Checkout popup UX

## Goals

1. **Fast prices** — `GET /api/account/pricing` must not fan out into dozens of per-key D1 reads; batch via `getSettings`.
2. **Inline auth everywhere** — email → confirmation code → optional TOTP on checkout, `/login`, header Sign-in popup, and native apps (no forced `/login` round-trip when the surface can host the form).
3. **Return-to-origin** — reuse the existing magic-link `redirect` + `client` (`browser` | `pwa` | `native`) stamps so a user who taps the email link *or* types the OTP lands back on the video, article, account page, or checkout panel that started sign-in.
4. **Less clutter** — hide promo UI when promotions are off; never block Stripe with “Promo codes are currently disabled” when no code was entered; drop newsletter opt-out from checkout; soft-pedal bank CTAs/errors; make legal + trust copy editable in admin.

## Non-goals

- Rewriting the auth module (extend magic-link tokens with an OTP hash; keep link flow).
- Removing legal consent checkbox (keep affirmative consent; make wording admin-editable).
- Changing Stripe Embedded Checkout architecture.
- Inventing a second return-path system — expand the magic-link `client`/`redirect` contract instead.

## API

### Pricing

- `handleGetPricing` loads all needed keys in **one** `getSettings` call.
- Response adds:
  - `promotionsEnabled: boolean`
  - `checkoutCopy: { termsAcceptLabel?: string; trustBlurb?: string }` (empty → client locale defaults)

### Promo resolution bug

`resolvePromoCodeForCheckout` must treat **empty / missing** promo as `reason: 'empty'` even when `promotions_enabled=0`, so Stripe checkout sessions create normally.

### Magic-link OTP (+ client overlap)

- Migration: `magic_link_tokens.otp_hash TEXT` (nullable; indexed).
- On magic-link create: also mint a 6-digit OTP, store `otp_hash`, include code in Brevo email (and `[DEV]` log). Stamp `client` + `redirect` on the verify URL exactly as today.
- `POST /api/auth/verify-code` body `{ email, code, client? }`:
  - browser / pwa → cookie session (same as `GET /api/auth/verify`)
  - `client=native` → `refreshToken` in JSON (same contract as `POST /api/auth/native/redeem`)
- Rate-limit verify-code attempts (reuse magic-link throttle fingerprinting where practical).

### Admin copy

Stored in `admin_settings`:

| Key | Purpose |
|-----|---------|
| `checkout_terms_accept_label` | Checkbox label (locale default if empty) |
| `checkout_trust_blurb` | Footer trust line under payment methods |

Editable from Admin → Payment plans (or System branding-adjacent section). Persisted consent rows continue to use `CHECKOUT_CONSENT_TEXT` / version from `@vmp/shared` unless the admin override is present at checkout time (store the effective text shown).

## Frontend

Shared `InlineAuthForm` / `useInlineAuth` (always pass `redirect` + resolved `client`):

- `SubscriptionCheckoutPanel` — inline when `!isLoggedIn`; checkout redirect includes `showPremium` / `checkout_plan` / `checkout_provider`.
- `/login` — same email → code → TOTP; honors `?redirect=`.
- `AppHeader` Sign in — popup (same chrome as the account menu) with inline auth; stamps current `route.fullPath` as return path. Full `/login` page remains as a link / iOS PWA push-login entry.
- `useLoginFlow.startLoginFlow` — when redirect omitted, defaults to current path (skips `/login` and `/auth/*`).

Native (`apps/mobile`):

- Login screen supports email → code; `requestMagicLink(..., client: 'native')` + `verify-code` with `client: 'native'`.
- Deep-link magic-link redeem unchanged; OTP and link share return `redirect`.

Also:

- Hide newsletter opt-out (account page only).
- Promo block only if `promotionsEnabled`; collapsed behind “Have a promo code?” until expanded.
- Prefer Stripe; tuck legacy/GoPay/Comgate under secondary actions.
- Use `checkoutCopy` overrides when non-empty.

## Tests

- Promo disabled + empty code → checkout path treats as empty.
- Pricing handler uses batched settings (unit-level on helpers / response shape).
- OTP verify happy path + wrong code + TOTP pending (auth tests).
- `resolveAuthReturnPath` rejects auth intermediates / open redirects.
- Native `verify-code` client contract posts `client: 'native'` and expects `refreshToken`.
