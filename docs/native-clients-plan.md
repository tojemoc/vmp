# Native & TV clients — multi-tier plan

Living plan for store apps that sit beside the existing Nuxt PWA (`@vmp/web`). The PWA remains the web product; native clients solve iOS protocol handoff, reliable push, offline downloads, and TV surfaces.

**Roadmap:** [ROADMAP.md](../ROADMAP.md) → *Native / TV clients* (`native-clients`)  
**Issue:** [#647](https://github.com/tojemoc/vmp/issues/647)

## Goals

1. **Working protocol handoff on phone/tablet** — magic-link email opens the installed app and establishes a session. No iOS PWA “notification login” (`pwa-push-login`).
2. **Robust push + offline downloads** — APNs/FCM and native filesystem, reusing existing offline authorize/license APIs where possible.
3. **Native-quality HLS playback** — shared API/business logic; platform players for media.
4. **TV later, without rewriting Tier 1** — pairing-code auth and focus UI as additive layers.

## Tiers

| Tier | Platforms | UI / runtime | Auth | Player | Code reuse |
| --- | --- | --- | --- | --- | --- |
| **1** | iOS + Android (phone/tablet) | Expo (React Native) + thin native modules | Magic link → verified HTTPS Universal Links / App Links; `vmp://` dev fallback only | `expo-video` first; AVPlayer / ExoPlayer if needed | `@vmp/shared`, HTTP client vs `@vmp/api` |
| **2** | tvOS + Android TV / Google TV | Same RN app via `react-native-tvos`; **rebuild screens** for D-pad focus (`react-tv-space-navigation` or equivalent) | **Pairing code** (TV shows code; user confirms on phone/web) | System / native TV player | Same shared client + most navigation shell; not touch layouts |
| **3** | Tizen (Samsung) + webOS (LG) | Proprietary web runtimes (Tizen Web / Luna + Enact) | Same pairing-code flow as Tier 2 | Platform HTML5 / AVPlay | HTTP/TS client only — **no** RN modules |
| **4** | Titan OS (Philips / AOC) + VIDAA / HomeOS (Hisense) | Dedicated hosted HTML5 / CTV web apps (Chromium or OEM browser), same pairing UX as Tier 3 | Same pairing-code flow as Tier 2 | Platform HTML5 media / OEM player APIs | Same thin HTTP/TS client as Tier 3 — **no** RN modules; port after one Tier 3 proof |

TVs never open emailed magic links. Pairing is the correct auth pattern for Tiers 2–4.

## Phasing

| Phase | Scope | Goal |
| --- | --- | --- |
| **0** | API contracts | Native magic-link redeem (refresh token in JSON), body-based refresh/logout, device push token register, device-pairing start/preview/complete/poll. Unblocks Tier 2–4 later. |
| **1** | Tier 1 PoC | Expo app: handoff, push register, catalog + one video online, offline download path wired to existing APIs. |
| **2** | Tier 2 PoC | RN-tvOS fork on same app; focus nav for catalog + watch; pairing-code login; system player. |
| **3** | Tier 3 PoC | **One** of Tizen or webOS as proof; lightweight web client against `@vmp/api`; pairing auth; no RN. |
| **4** | Tier 4 PoC | Dedicated Titan OS and/or VIDAA apps from the Tier 3 HTML5 shell (store/CSP paperwork + OEM QA); pairing auth unchanged. |
| **5** | Decision gate | Compare Tiers 1–4 before full store builds / parity with PWA. |

## Phase 0 API (contracts)

Base URL: existing `@vmp/api` Worker. Errors: `{ error: string, code?: string }`.

### Native session (Tier 1 deep link)

| Method | Path | Auth | Body / notes |
| --- | --- | --- | --- |
| `POST` | `/api/auth/native/redeem` | none | `{ token }` — consumes magic-link token; returns `{ ok, accessToken, refreshToken, user }` (and 2FA pending shape when required). Prefer this over cookie-only `GET /api/auth/verify` in native apps. |
| `POST` | `/api/auth/2fa/verify` | none | `{ code, pendingToken }` — completes TOTP after redeem/verify. Returns `{ ok, accessToken, refreshToken, user }` plus refresh cookie (web). Native apps must persist `refreshToken` from the body. |
| `POST` | `/api/auth/refresh` | none | Cookie **or** `{ refreshToken }` — rotates refresh token. Body-based responses include `refreshToken` in JSON for secure storage. Cookie-only clients unchanged (no refresh token in JSON). |
| `POST` | `/api/auth/logout` | none | Cookie **or** `{ refreshToken }` — deletes refresh row. |

Deep link targets:

| Target | When | Notes |
| --- | --- | --- |
| `https://<FRONTEND_HOST>/auth/verify?token=…&client=native` | **Production + staging** | Universal Links (iOS) / App Links (Android). Required for store builds. `client` is stamped when the native app requests the magic link. |
| `https://<FRONTEND_HOST>/auth/verify?token=…&client=browser` | Website login | Redeem in the browser; no PWA / native bounce. |
| `https://<FRONTEND_HOST>/auth/verify?token=…&client=pwa` (+ optional `pwa=1`) | Installed Home Screen web app | Push-login when `pwa=1`; otherwise iOS Safari may exchange for a short-lived handoff. |
| `vmp://auth/verify?token=…` | **Local + staging SideStore PoC only** | Fail-closed in the app (`EXPO_PUBLIC_ENABLE_VMP_SCHEME=1`, no `DISABLE`). **release/beta/nightly** Mobile artifact builds always force the scheme off. **`flavor=development` + `enable_custom_scheme`** may enable it for SideStore. Staging web opens `vmp://` only after a two-step confirm + D1 `insecure_native_scheme_acks` row, and only when `ALLOW_INSECURE_NATIVE_VMP_SCHEME=1` (staging CI). Not a substitute for Universal Links (checklist **S6**). |

**Client-tagged emails:** `POST /api/auth/magic-link` accepts `{ client: 'browser' \| 'pwa' \| 'native' }` and embeds it in the verify URL. Web login defaults to `browser` (or `pwa` when `isInstalledPwa()`); Expo login sends `native`. `/auth/verify` routes from that tag instead of guessing User-Agent / display-mode.

**How magic-link → app is supposed to work (read this before inventing handoffs)**

1. **Website login** emails `…/auth/verify?token=…&client=browser`. The browser redeems the token and sets cookies. No app involvement.
2. **Native app login** emails the **same HTTPS URL** with `client=native`. The OS should open the **installed app** via **Universal Links (iOS)** / **App Links (Android)** — not a custom `vmp://` scheme. The app calls `POST /api/auth/native/redeem` with the token.
3. **Home Screen PWA (iOS)** uses the separate push-login path (`client=pwa` / `pwa=1`), because Safari and the PWA do not share cookies.

**Why Universal Links “don’t work” today on `vmp.tjm.sk`:** the Worker already serves `/.well-known/apple-app-site-association` and `assetlinks.json`, but both **404 with “Not configured”** until the maintainer sets GitHub repo vars `MOBILE_APPLE_APP_IDS_*` and `MOBILE_ANDROID_SHA256_CERT_FINGERPRINTS_*` and redeploys. Without those files, iOS/Android **must** open the link in the browser — that is expected, not a bug in `/auth/verify`.

**SideStore caveat:** each tester re-signs the IPA with their own Apple ID → different Team ID → AASA cannot list every tester. Universal Links need a **stable** Team ID (TestFlight / App Store / shared dev team). **Temporary staging escape hatch:** build Mobile artifacts with `flavor=development` and `enable_custom_scheme=true`, then on **staging** `/auth/verify?client=native` complete the two-step insecure confirm (checkbox + confirm). The API records an acknowledgment in D1 and only then may Safari open `vmp://` with the still-unused magic-link token. Production / beta web never expose this path.

**Custom schemes (`vmp://`):** claimable by any app. Off for release/beta/nightly CI; optional for development SideStore PoC with staging double-confirm + D1 ack. Not a substitute for Universal Links.

**AASA / Digital Asset Links status:** **Routes exist; signing values unset on staging/prod (404).** The web Worker serves both documents from `packages/web/server/routes/.well-known/`, assembled from deploy env:

| Env var | Contents |
| --- | --- |
| `MOBILE_ANDROID_SHA256_CERT_FINGERPRINTS` | Upper-case colon-form SHA-256 signing fingerprints (space/comma separated) for `/.well-known/assetlinks.json` |
| `MOBILE_APPLE_APP_IDS` | `<AppleTeamId>.<bundleId>` entries (space/comma separated) for `/.well-known/apple-app-site-association` |
| `MOBILE_ANDROID_PACKAGE` | Optional override; defaults to `sk.tjm.vmp` |

CI passes these from `vars.MOBILE_*_STAGING` / `vars.MOBILE_*_PROD` (see `.github/actions/deploy-cloudflare/action.yml`). While unset, both routes answer 404 and App Links verification cannot succeed — supplying the values is what remains of open issue **#5** below and checklist item **S5**. `apps/mobile/app.json` keeps `REPLACE_WITH_FRONTEND_HOST`: the mobile build workflow substitutes the real host per flavour, so it must **not** be hardcoded.

Production note: prefer exchanging a one-time handoff code (bound to app install) over passing raw magic-link tokens via custom schemes if a non-HTTPS fallback is ever required post-launch.

### Device pairing (Tiers 2–4; endpoints land in Phase 0)

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/auth/device-pairing/start` | none | Creates short-lived session; optional `{ deviceName, devicePlatform }`; returns `{ pairingCode, expiresAt, pollIntervalSeconds }`. Default code is **10** Crockford-style chars (~50 bits). Rate-limited per IP (`pairing_start_limit_per_ip`, default 10/min) **and** globally (`pairing_start_limit_global`, default 60/min) via `SegmentRateLimiterDO`. **Fail-closed** (429) when the limiter binding is unavailable. |
| `POST` | `/api/auth/device-pairing/preview` | Bearer JWT | `{ pairingCode }` — inspect device label before approve. Per-IP (`pairing_preview_limit_per_ip`, default 30/min), **global** (`pairing_preview_limit_global`, default 120/min), **and** per-code (`pairing_preview_limit_per_code`, default 8/min) via `SegmentRateLimiterDO`. Per-code limits are not sufficient alone (guesses can fan out across codes). |
| `POST` | `/api/auth/device-pairing/complete` | Bearer JWT | `{ pairingCode }` — logged-in phone/web approves the TV/device session. |
| `POST` | `/api/auth/device-pairing/poll` | none | `{ pairingCode }` — `pending` \| `expired` \| `ready` + session tokens when ready (one-shot redeem). Unknown, missing, or malformed codes return **`200 pending`** (no validity oracle). Per-IP (`pairing_poll_limit_per_ip`, default 120/min) **and** global (`pairing_poll_limit_global`, default 600/min) via `SegmentRateLimiterDO`. **Fail-closed** when the limiter is unavailable. **TV clients:** validate code format locally before calling (see below); bound polling by `expiresAt` and/or max attempts; after the bound, stop with the same non-validating outcome as a long `pending` wait. |

**TV poll client guidance**

1. **Local format gate (before each `poll`):** Normalize like the API (`normalizePairingCode` in `packages/api/src/nativeClients.ts`): trim, uppercase, strip non-alphanumerics, length **6–12**. If invalid, **do not call `poll`** — keep the waiting UI indistinguishable from `200 pending`. Never surface "invalid code" or other validity hints.
2. **Polling bound:** Stop when **`Date.now() >= expiresAt`** from `start` **or** a client max-attempt budget is exhausted (recommended: `ceil((expiresAt - startedAt) / pollIntervalSeconds)`). After the bound without `ready`, `expired`, or `409 already_used`, stop polling and show the same non-validating timeout UX (offer `start` for a fresh code). Do **not** distinguish unknown, unapproved, or TTL-elapsed codes in copy or client error codes.
3. **Never infer validity from `pending`:** Server returns `200 pending` for genuine pending sessions **and** for unknown/malformed codes — treat every `pending` the same.

**TV poll recovery:** `poll` atomically marks the session `redeemed` when returning `ready`. There is **no retry window** with the same code after a successful redeem.

| Response | TV client action |
| --- | --- |
| `200` + `pending` | Back off per `pollIntervalSeconds`; keep polling. Also returned for unknown/malformed codes (do not treat as fatal). Skip `poll` entirely when local format validation fails — same waiting UI, no validity hints |
| Polling bound reached (`expiresAt` or max attempts) | Terminal — same non-validating timeout UX as a long `pending` wait; call `start` for a new code. Do **not** reveal whether the code was unknown vs unapproved |
| `429 rate_limited` | Retry with exponential backoff; **do not** call `start` |
| Transient `5xx` / network error | Retry with backoff; session may still be valid |
| `200` + `ready` | Persist tokens immediately from body |
| `409 already_used` after approve | Terminal — call `start` and show a **new** code (lost response after server redeem) |
| `200` + `expired` | Terminal — call `start` |

Do **not** call `start` on retryable errors — that orphans the in-flight pairing session and forces unnecessary phone re-approval.

### Native push registration (Tier 1+)

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| `POST` | `/api/push/device` | Bearer JWT | `{ platform: 'ios' \| 'android', token, deviceId? }` — upsert APNs/FCM token. |
| `DELETE` | `/api/push/device` | Bearer JWT | JSON body **preferred**. Query fallback `{ token }` / `{ deviceId }` for clients that drop DELETE bodies. **Query values must be redacted** (`[redacted]`) at the API edge and in worker logs (`redactPushDeviceQuery`). Never log raw query tokens. |

Web Push (`/api/push/subscribe`, VAPID) stays for the PWA. Native delivery (APNs/FCM send path) is a follow-up after tokens are stored.

**Permission gate (mobile):** `apps/mobile/src/features.ts` exports `nativePushEnabled`, driven by build-time `EXPO_PUBLIC_NATIVE_PUSH_ENABLED` (`1` / `true` only). Default is **off**. Any notification permission prompt or token registration UI must check this flag; flip it only when the server send path ships in the same release.

### Reused as-is

- `POST /api/auth/magic-link` — body may include `client: 'browser' | 'pwa' | 'native'`; email verify URL carries the same tag so `/auth/verify` does not guess the originating surface.
- `GET /api/videos`, `GET /api/video-access/{videoId}` (preferred; user from JWT), video proxy, offline device + download APIs.
  Legacy `GET /api/video-access/{userId}/{videoId}` remains for old clients only.

## Tier 1 PoC success criteria

1. Magic link opens the **installed** app and yields a session **without** push-login.
2. When `EXPO_PUBLIC_NATIVE_PUSH_ENABLED=1` (non-default), device push token registers against `/api/push/device` in the same release as APNs/FCM delivery. **Default PoC builds leave the flag unset** — criterion N/A until delivery ships.
3. One published video: online HLS + offline authorize/download/play using existing offline APIs.
4. Web PWA unchanged (including existing iOS push-login for Home Screen users until a later deprecation decision).

## Explicit non-goals / known PoC gaps

- Admin UI, Stripe, MoQ livestreams, Brevo campaigns, full PWA feature parity, shipping Tizen/webOS/Titan/VIDAA in Phase 1.
- **APNs/FCM delivery** — token storage only; `nativePushEnabled` (`EXPO_PUBLIC_NATIVE_PUSH_ENABLED`) stays false until send path exists.
- **Portrait-only orientation** and **background audio disabled** in `app.json` — checklist **S2/S3** before store.
- **Cross-device magic link** — single-use token opened on laptop/phone mismatch; copy + error only in PoC; checklist **S7**.
- **Unverified TV pairing labels** — TV self-reports `deviceName` / `devicePlatform`; checklist **S8**.
- **`apps/mobile` outside npm workspaces** — promote per checklist **W1–W4** before TestFlight.

Approve TV lives under **Settings** (not the home header). Checklist **S4** is a regression check at promotion.

## Open PoC issues (track before store)

See also: **[promotion checklist](native-clients-promotion-checklist.md)** (blocking S-rows).

1. Landscape / rotation support for watch (**S2**).
2. Optional background audio / PiP policy for long-form (**S3**).
3. APNs/FCM send path + permission UX (**S9**).
4. Publish AASA + Digital Asset Links on production host (**S5** — not live; placeholder in `app.json`).
5. Workspace promotion + Nx `start` target for mobile (**W3**).
6. Cross-device magic-link UX — same email on desktop vs phone consumes token (**S7**).
7. TV pairing label trust — self-reported device context at approve time (**S8**).
8. Pairing abuse controls — per-IP **and global** start/poll/preview budgets plus preview per-code limits, fail-closed limiter, before any **public announcement** of pairing (**S10**).
9. `vmp://` demoted to dev-only before store; HTTPS deep links primary (**S6**).

## Package layout

| Path | Role |
| --- | --- |
| `apps/mobile` | Expo Tier 1 app (not an npm workspace member yet — install locally; see app README) |
| `packages/api` | Phase 0 routes + migrations |
| `packages/shared` | Shared types for native client contracts |
| `docs/native-clients-plan.md` | This document |
| `docs/native-clients-promotion-checklist.md` | Blocking checklist before workspace promotion / TestFlight |

## Decision log

- **2026-08**: Agree Expo + thin native modules for Tier 1; `react-native-tvos` for Tier 2; separate web clients for Tier 3; pairing-code auth for all TV; Phase 0 contracts before Tier 1 UI polish.
- **2026-09**: Add Tier 4 dedicated apps for Titan OS (after Tizen) and VIDAA/HomeOS (after webOS); decision gate becomes Phase/Tier 5.
- **2026-08 (review)**: Prefer body `refreshToken` over cookie when both present; native redeem does not set refresh cookie; pairing preview + device labels; push token ownership check; document 2FA/push/workspace gaps.
- **2026-08 (review 2)**: Pairing poll is one-shot — lost `ready` response requires new `start`; push permission gated by `EXPO_PUBLIC_NATIVE_PUSH_ENABLED`.
- **2026-08 (review 3)**: Promotion checklist; numbered open issues for cross-device magic link, TV labels; poll retry vs terminal errors; AASA not live yet.
- **2026-08 (review 4)**: Approve TV moved under Settings; checklist requires named maintainer sign-off; DELETE `/api/push/device` accepts body or query.
- **2026-08 (review 5)**: `vmp://` opt-in default off; query token redaction; preview per-code rate limit; self-reported label copy.
- **2026-08 (review 6)**: Pairing rate limits moved to `admin_settings` (migration 0046).
- **2026-08 (review 7)**: Pairing counters use `SegmentRateLimiterDO`; `parsePairingLimit` rejects non-integer values.
- **2026-08 (review 8)**: `vmp://` ENABLE is canonical; DISABLE=1 always wins. Pairing codes default to 10 chars; start/poll/preview have global DO budgets in addition to per-IP; limiter fail-closed; poll unknown/malformed returns `pending`.
- **2026-08 (review 9)**: TV poll client guidance — local format gate, `expiresAt`/max-attempt bound, non-validating timeout UX.
- **2026-09 (S1)**: Native TOTP entry screen (`apps/mobile/app/auth/2fa.tsx`); `POST /api/auth/2fa/verify` returns `refreshToken` in JSON for secure storage (cookie retained for web).
