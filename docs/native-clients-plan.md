# Native & TV clients — multi-tier plan

Living plan for store apps that sit beside the existing Nuxt PWA (`@vmp/web`). The PWA remains the web product; native clients solve iOS protocol handoff, reliable push, offline downloads, and TV surfaces.

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

TVs never open emailed magic links. Pairing is the correct auth pattern for Tiers 2–3.

## Phasing

| Phase | Scope | Goal |
| --- | --- | --- |
| **0** | API contracts | Native magic-link redeem (refresh token in JSON), body-based refresh/logout, device push token register, device-pairing start/preview/complete/poll. Unblocks Tier 2/3 later. |
| **1** | Tier 1 PoC | Expo app: handoff, push register, catalog + one video online, offline download path wired to existing APIs. |
| **2** | Tier 2 PoC | RN-tvOS fork on same app; focus nav for catalog + watch; pairing-code login; system player. |
| **3** | Tier 3 PoC | **One** of Tizen or webOS as proof; lightweight web client against `@vmp/api`; pairing auth; no RN. |
| **4** | Decision gate | Compare all three before full store builds / parity with PWA. |

## Phase 0 API (contracts)

Base URL: existing `@vmp/api` Worker. Errors: `{ error: string, code?: string }`.

### Native session (Tier 1 deep link)

| Method | Path | Auth | Body / notes |
| --- | --- | --- | --- |
| `POST` | `/api/auth/native/redeem` | none | `{ token }` — consumes magic-link token; returns `{ ok, accessToken, refreshToken, user }` (and 2FA pending shape when required). Prefer this over cookie-only `GET /api/auth/verify` in native apps. |
| `POST` | `/api/auth/refresh` | none | Cookie **or** `{ refreshToken }` — rotates refresh token. Body-based responses include `refreshToken` in JSON for secure storage. Cookie-only clients unchanged (no refresh token in JSON). |
| `POST` | `/api/auth/logout` | none | Cookie **or** `{ refreshToken }` — deletes refresh row. |

Deep link targets:

| Target | When | Notes |
| --- | --- | --- |
| `https://<FRONTEND_HOST>/auth/verify?token=…` | **Production + staging** | Universal Links (iOS) / App Links (Android). Required for store builds. |
| `vmp://auth/verify?token=…` | **Local PoC / dev only** | **Off by default.** Enable with `EXPO_PUBLIC_ENABLE_VMP_SCHEME=1` (or `EXPO_PUBLIC_DISABLE_VMP_SCHEME=0`). Token redemption is gated in `apps/mobile/src/auth/session.ts` via `customSchemeDeepLinksAllowed`. Non-exclusive — any app could register `vmp://`. Store builds must not set the flag (checklist **S6**). |

**AASA / Digital Asset Links status:** **Not published yet.** `apps/mobile/app.json` still uses `REPLACE_WITH_FRONTEND_HOST`. Publishing verified association files on the real frontend host is open issue **#5** below and checklist item **S5**.

Production note: prefer exchanging a one-time handoff code (bound to app install) over passing raw magic-link tokens via custom schemes if a non-HTTPS fallback is ever required post-launch.

### Device pairing (Tiers 2–3; endpoints land in Phase 0)

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/auth/device-pairing/start` | none | Creates short-lived session; optional `{ deviceName, devicePlatform }`; returns `{ pairingCode, expiresAt, pollIntervalSeconds }`. IP rate-limited (`admin_settings.pairing_start_limit_per_ip`, default 10/min) via `SegmentRateLimiterDO`. |
| `POST` | `/api/auth/device-pairing/preview` | Bearer JWT | `{ pairingCode }` — inspect device label before approve. IP (`pairing_preview_limit_per_ip`, default 30/min) **and** per-code (`pairing_preview_limit_per_code`, default 8/min) rate limited via `SegmentRateLimiterDO`. |
| `POST` | `/api/auth/device-pairing/complete` | Bearer JWT | `{ pairingCode }` — logged-in phone/web approves the TV/device session. |
| `POST` | `/api/auth/device-pairing/poll` | none | `{ pairingCode }` — `pending` \| `expired` \| `ready` + session tokens when ready (one-shot redeem). IP rate-limited (`pairing_poll_limit_per_ip`, default 120/min) via `SegmentRateLimiterDO`. |

**TV poll recovery:** `poll` atomically marks the session `redeemed` when returning `ready`. There is **no retry window** with the same code after a successful redeem.

| Response | TV client action |
| --- | --- |
| `200` + `pending` | Back off per `pollIntervalSeconds`; keep polling |
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

- `POST /api/auth/magic-link` — email still contains the web verify URL; the installed app intercepts it.
- `GET /api/videos`, `GET /api/video-access/{videoId}` (preferred; user from JWT), video proxy, offline device + download APIs.
  Legacy `GET /api/video-access/{userId}/{videoId}` remains for old clients only.

## Tier 1 PoC success criteria

1. Magic link opens the **installed** app and yields a session **without** push-login.
2. When `EXPO_PUBLIC_NATIVE_PUSH_ENABLED=1` (non-default), device push token registers against `/api/push/device` in the same release as APNs/FCM delivery. **Default PoC builds leave the flag unset** — criterion N/A until delivery ships.
3. One published video: online HLS + offline authorize/download/play using existing offline APIs.
4. Web PWA unchanged (including existing iOS push-login for Home Screen users until a later deprecation decision).

## Explicit non-goals / known PoC gaps

- Admin UI, Stripe, MoQ livestreams, Brevo campaigns, full PWA feature parity, shipping Tizen/webOS in Phase 1.
- **Native TOTP / 2FA UI** — API returns `requiresTwoFactor`; Expo does not collect TOTP yet. **Editors/admins cannot complete native sign-in in this PoC.** Prefer viewer accounts for internal testing, or add TOTP before staff testing.
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
3. Native TOTP entry + `/api/auth/2fa/verify` wiring (**S1**).
4. APNs/FCM send path + permission UX (**S9**).
5. Publish AASA + Digital Asset Links on production host (**S5** — not live; placeholder in `app.json`).
6. Workspace promotion + Nx `start` target for mobile (**W3**).
7. Cross-device magic-link UX — same email on desktop vs phone consumes token (**S7**).
8. TV pairing label trust — self-reported device context at approve time (**S8**).
9. Pairing preview per-code limits — keep in place before any **public announcement** of pairing (**S10**).
10. `vmp://` demoted to dev-only before store; HTTPS deep links primary (**S6**).

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
- **2026-08 (review)**: Prefer body `refreshToken` over cookie when both present; native redeem does not set refresh cookie; pairing preview + device labels; push token ownership check; document 2FA/push/workspace gaps.
- **2026-08 (review 2)**: Pairing poll is one-shot — lost `ready` response requires new `start`; push permission gated by `EXPO_PUBLIC_NATIVE_PUSH_ENABLED`.
- **2026-08 (review 3)**: Promotion checklist; numbered open issues for cross-device magic link, TV labels; poll retry vs terminal errors; AASA not live yet.
- **2026-08 (review 4)**: Approve TV moved under Settings; checklist requires named maintainer sign-off; DELETE `/api/push/device` accepts body or query.
- **2026-08 (review 5)**: `vmp://` opt-in default off; query token redaction; preview per-code rate limit; self-reported label copy.
- **2026-08 (review 6)**: Pairing rate limits moved to `admin_settings` (migration 0046).
- **2026-08 (review 7)**: Pairing counters use `SegmentRateLimiterDO`; `parsePairingLimit` rejects non-integer values.
