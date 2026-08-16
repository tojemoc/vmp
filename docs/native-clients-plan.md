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
| **1** | iOS + Android (phone/tablet) | Expo (React Native) + thin native modules | Magic link → Universal Links / App Links (+ `vmp://` fallback) | `expo-video` first; AVPlayer / ExoPlayer if needed | `@vmp/shared`, HTTP client vs `@vmp/api` |
| **2** | tvOS + Android TV / Google TV | Same RN app via `react-native-tvos`; **rebuild screens** for D-pad focus (`react-tv-space-navigation` or equivalent) | **Pairing code** (TV shows code; user confirms on phone/web) | System / native TV player | Same shared client + most navigation shell; not touch layouts |
| **3** | Tizen (Samsung) + webOS (LG) | Proprietary web runtimes (Tizen Web / Luna + Enact) | Same pairing-code flow as Tier 2 | Platform HTML5 / AVPlay | HTTP/TS client only — **no** RN modules |

TVs never open emailed magic links. Pairing is the correct auth pattern for Tiers 2–3.

## Phasing

| Phase | Scope | Goal |
| --- | --- | --- |
| **0** | API contracts | Native magic-link redeem (refresh token in JSON), body-based refresh/logout, device push token register, device-pairing start/complete/poll. Unblocks Tier 2/3 later. |
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

Deep link targets (app claims; not served as HTML by the API):

- `https://<FRONTEND_HOST>/auth/verify?token=…` (Universal Links / App Links)
- `vmp://auth/verify?token=…` (custom scheme fallback)

Associated Domains / Digital Asset Links files are published with the Tier 1 app IDs (see `apps/mobile/README.md`).

### Device pairing (Tiers 2–3; endpoints land in Phase 0)

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `POST` | `/api/auth/device-pairing/start` | none | Creates short-lived session; returns `{ pairingCode, expiresAt, pollIntervalSeconds }`. |
| `POST` | `/api/auth/device-pairing/complete` | Bearer JWT | `{ pairingCode }` — logged-in phone/web approves the TV/device session. |
| `POST` | `/api/auth/device-pairing/poll` | none | `{ pairingCode }` — `pending` \| `expired` \| `ready` + session tokens when ready (one-shot redeem). |

### Native push registration (Tier 1+)

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| `POST` | `/api/push/device` | Bearer JWT | `{ platform: 'ios' \| 'android', token, deviceId? }` — upsert APNs/FCM token. |
| `DELETE` | `/api/push/device` | Bearer JWT | `{ token }` or `{ deviceId }` — remove. |

Web Push (`/api/push/subscribe`, VAPID) stays for the PWA. Native delivery (APNs/FCM send path) is a follow-up after tokens are stored.

### Reused as-is

- `POST /api/auth/magic-link` — email still contains the web verify URL; the installed app intercepts it.
- `GET /api/videos`, video-access / proxy, offline device + download APIs.

## Tier 1 PoC success criteria

1. Magic link opens the **installed** app and yields a session **without** push-login.
2. Device push token registers against `/api/push/device`.
3. One published video: online HLS + offline authorize/download/play using existing offline APIs.
4. Web PWA unchanged (including existing iOS push-login for Home Screen users until a later deprecation decision).

## Explicit non-goals (PoC)

Admin UI, Stripe, MoQ livestreams, Brevo campaigns, full PWA feature parity, shipping Tizen/webOS in Phase 1.

## Package layout

| Path | Role |
| --- | --- |
| `apps/mobile` | Expo Tier 1 app (not an npm workspace member yet — install locally; see app README) |
| `packages/api` | Phase 0 routes + migrations |
| `packages/shared` | Shared types for native client contracts |
| `docs/native-clients-plan.md` | This document |

## Decision log

- **2026-08**: Agree Expo + thin native modules for Tier 1; `react-native-tvos` for Tier 2; separate web clients for Tier 3; pairing-code auth for all TV; Phase 0 contracts before Tier 1 UI polish.
