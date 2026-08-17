# VMP mobile (Tier 1 PoC)

Expo (React Native) phone/tablet client. Plan: [`docs/native-clients-plan.md`](../../docs/native-clients-plan.md).

## Status

Scaffold + API client for Phase 0 / Tier 1 PoC:

- Magic-link request → deep-link redeem via `POST /api/auth/native/redeem`
- Secure session storage (`expo-secure-store`)
- Catalog + watch skeleton (`expo-video`) via `GET /api/video-access/{videoId}` (JWT supplies user)
- Device pairing **Approve a TV** under Settings (`preview` + `complete`)
- Native push **token register API** only — gated by `nativePushEnabled` in `src/features.ts` (`EXPO_PUBLIC_NATIVE_PUSH_ENABLED`, default off)

### Explicit PoC blockers / gaps

| Gap | Who it blocks | Notes |
| --- | --- | --- |
| No native TOTP UI | Editors/admins (2FA-enforced roles) | API returns `requiresTwoFactor`; app shows an explicit error. Use a non-2FA viewer for PoC testing, or add TOTP before staff testing. |
| No APNs/FCM send path | Anyone expecting push content | Token register exists; `EXPO_PUBLIC_NATIVE_PUSH_ENABLED` must stay unset until delivery lands. |
| Portrait-only + no background audio | UX polish | Tracked in plan “Open PoC issues”; change before store submission. |
| Cross-device magic link | Same email opened on wrong device | Checklist **S7**; login copy warns single-use |
| Unverified TV labels | Phishing at scale (future) | Checklist **S8** |

## Why not an npm workspace member?

Root `package.json` workspaces are `packages/*` only. This app lives under `apps/mobile` so Expo’s dependency tree does not force a root lockfile rewrite during the PoC.

**Promotion trigger:** join the root npm workspace (and CI) **before the first TestFlight / internal Play track build**. Complete [`docs/native-clients-promotion-checklist.md`](../../docs/native-clients-promotion-checklist.md) — every **S-row** must pass or be waived.

```bash
cd apps/mobile
npm ci
EXPO_PUBLIC_API_URL=http://10.0.2.2:8787 npx expo start
```

`package-lock.json` in this directory is committed so `npm ci` is reproducible. After changing `package.json` versions, run `npm install` here (not the repo root) to refresh this lockfile.

`EXPO_PUBLIC_API_URL` is **required** (no localhost default — that only targets the device itself).

| Host | Typical `EXPO_PUBLIC_API_URL` |
| --- | --- |
| Android emulator → host machine | `http://10.0.2.2:8787` |
| iOS simulator → host machine | `http://127.0.0.1:8787` |
| Physical device | `http://<lan-ip>:8787` |

Nx is not wired for this app while it sits outside workspaces; use the Expo CLI commands above. After workspace promotion, add an Nx `start` target and prefer `npm exec nx start mobile` (or the chosen project name).

## Deep links

| Scheme | Example | When |
| --- | --- | --- |
| Custom | `vmp://auth/verify?token=…` | **Off by default.** Opt in with `EXPO_PUBLIC_ENABLE_VMP_SCHEME=1` (or `EXPO_PUBLIC_DISABLE_VMP_SCHEME=0`) for local PoC. `session.ts` ignores `vmp://` tokens unless that flag is set. Store builds must leave both unset (checklist S6). |
| Universal / App Link | `https://<FRONTEND_HOST>/auth/verify?token=…` | **Required** for TestFlight / production |

Replace `REPLACE_WITH_FRONTEND_HOST` in `app.json` before store builds. Publish Apple `apple-app-site-association` and Android Digital Asset Links on that host (same path the magic-link email already uses).

Magic-link tokens are single-use: if the link was opened on another device first, redeem fails with an explicit “already used (including on another device)” message.

## Pairing (Tier 2+)

`apps/mobile/app/pairing.tsx` is reached from **Settings → Approve a TV** (not the home header):

1. Enter the code shown on the TV.
2. **Preview** → `POST /api/auth/device-pairing/preview` (device name/platform, shown with “Label set by the device”).
3. **Approve** → `POST /api/auth/device-pairing/complete`.

## Native push (when enabled)

Set `EXPO_PUBLIC_NATIVE_PUSH_ENABLED=1` only in builds where APNs/FCM delivery is live. Code must check `nativePushEnabled` from `src/features.ts` before calling `registerNativePushDevice` or requesting OS notification permission.
