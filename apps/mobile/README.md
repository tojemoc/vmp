# VMP mobile (Tier 1 PoC)

Expo (React Native) phone/tablet client. Plan: [`docs/native-clients-plan.md`](../../docs/native-clients-plan.md).

## Status

Scaffold + API client for Phase 0 / Tier 1 PoC:

- Magic-link request → deep-link redeem via `POST /api/auth/native/redeem`
- Native TOTP / 2FA entry (`/auth/2fa`) when redeem returns `requiresTwoFactor` → `POST /api/auth/2fa/verify`
- Secure session storage (`expo-secure-store`)
- Catalog + watch skeleton (`expo-video`) via `GET /api/video-access/{videoId}` (JWT supplies user)
- Offline download + play (same authorize/assets APIs as the PWA): register device → authorize → fetch HLS into `expo-file-system` → play local master playlist; **Downloads** under home/Settings
- Device pairing **Approve a TV** under Settings (`preview` + `complete`)
- Native push **token register API** only — gated by `nativePushEnabled` in `src/features.ts` (`EXPO_PUBLIC_NATIVE_PUSH_ENABLED`, default off)

### Explicit PoC blockers / gaps

| Gap | Who it blocks | Notes |
| --- | --- | --- |
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

## Manual GitHub artifact builds

GitHub Actions includes a manual-only workflow at `.github/workflows/mobile-artifacts.yml` (mirrors [tojemoc/floaty](https://github.com/tojemoc/floaty) SideStore distribution).

Use **Actions → Mobile artifacts → Run workflow** when you want ad-hoc test builds without building mobile binaries on every push.

Inputs:

- `api_url` — required; baked into `EXPO_PUBLIC_API_URL`
- `frontend_host` — required; replaces the placeholder Universal Links / App Links host in `app.json`, and is baked into `EXPO_PUBLIC_FRONTEND_HOST` so magic-link redeem only accepts that host’s `/auth/verify` URLs
- `flavor` — release channel tag prefix (`release`, `beta`, `nightly`, `development`; publishing any flavor requires dispatch from `main`)
- `build_number` — optional iOS build number (defaults to the GitHub Actions run number so each dispatch gets a unique tag). Retries of a failed publish may reuse that identity only for the same commit: a missing IPA is uploaded, an existing IPA is not replaced.
- `native_push_enabled` — toggles `EXPO_PUBLIC_NATIVE_PUSH_ENABLED`
- `enable_custom_scheme` — enables claimable `vmp://` **only** when `flavor=development` (staging SideStore PoC). Rejected for release/beta/nightly. Staging web still requires a double-confirm + D1 acknowledgment before Safari opens `vmp://` with the magic-link token. Local machines can also set `EXPO_PUBLIC_ENABLE_VMP_SCHEME=1`.
- `publish_release` — create GitHub Release + update AltStore source on GitHub Pages (default on; **main branch only** — disable for artifact-only builds from feature branches)
- `build_android` — also build/upload an Android test APK (default on)

Outputs (when the corresponding input is enabled):

- When `build_android` is enabled: Android release `.apk` uploaded as the workflow artifact **`mobile-android-apk`** (download from the run’s Artifacts section).
- When `publish_release` is enabled:
  - Ad-hoc signed iOS `.ipa` on GitHub Releases as `vmp-<version>-ios.ipa`
  - `altstore-source.json` deployed to GitHub Pages (generated from `altstore-source.meta.json`, not committed to git)
  - Install page at `https://<org>.github.io/<repo>/` with SideStore source link and secondary OTA link

SideStore source URL (after first publish on `main`):

`https://tojemoc.github.io/vmp/altstore-source.json`

See [`docs/ios-sidestore-distribution-playbook.md`](../../docs/ios-sidestore-distribution-playbook.md) for tester instructions (no Mac required).

## Deep links

| Scheme | Example | When |
| --- | --- | --- |
| Custom | `vmp://auth/verify?token=…` | **Off** for release/beta/nightly CI. **Optional** for Mobile artifacts `flavor=development` + `enable_custom_scheme=true` (staging SideStore PoC). Local opt-in: `EXPO_PUBLIC_ENABLE_VMP_SCHEME=1`. Kill switch `EXPO_PUBLIC_DISABLE_VMP_SCHEME=1` always wins. Staging web never opens `vmp://` until the user double-confirms and the API records a D1 ack (checklist S6). |
| Universal / App Link | `https://<FRONTEND_HOST>/auth/verify?token=…` | **Required** for TestFlight / production |

Both land on Expo Router screen `app/auth/verify.tsx` (required — without it the OS opens the app but Expo shows **Unmatched Route**). `SessionProvider` still listens for Linking events; redeem is deduped so cold-start + the verify screen do not consume the single-use token twice.

`REPLACE_WITH_FRONTEND_HOST` in `app.json` stays as-is — `.github/workflows/mobile-artifacts.yml` substitutes the dispatched `frontend_host` into both the iOS `associatedDomains` and the Android intent filter, so the committed value must remain a placeholder rather than one tier's host.

The matching association documents are served by the web Worker at `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`, built from the `MOBILE_ANDROID_SHA256_CERT_FINGERPRINTS` / `MOBILE_APPLE_APP_IDS` deploy vars. Until those are set the routes return 404 and `autoVerify` cannot succeed, so links open the browser instead of the app (checklist **S5**).

**Android browser fallback:** `/auth/verify?client=native` detects Android, does **not** redeem the token in the browser first, and opens a package-targeted `intent://…#Intent;scheme=https;package=sk.tjm.vmp;…` URL so the installed APK still receives the same HTTPS deep link. A “Continue in browser” path (or `?native_fallback=1`) keeps web sign-in. The APK’s `frontend_host` must match the site that sent the email so the intent filter host lines up.

**iOS:** Magic links requested from the native app carry `client=native`. Until AASA is live (or install-bound handoff codes exist), links that open in Safari redeem in the browser — web does not bounce via `vmp://`. Website login uses `client=browser` and redeems in Safari with no PWA/native bounce.

Magic-link tokens are single-use: if the link was opened on another device first, redeem fails with an explicit “already used (including on another device)” message.

## Offline downloads (Tier 1 PoC)

Watch screen **Download** (default `720p`) and **Downloads** list:

1. `POST /api/offline/devices/register` once → store `deviceId` / `deviceToken` in SecureStore
2. `POST /api/downloads/:videoId/authorize` with `x-vmp-device-token`
3. Fetch `GET /api/downloads/:videoId/assets/…?dt=` into app document storage
4. Rewrite playlists to relative local paths; play `offline-master.m3u8` via `expo-video`

Requires an R2-hosted HLS video (`r2_assets_required` if only CDN). License expiry is enforced before offline play; renew UI is deferred.

## Pairing (Tier 2+)

`apps/mobile/app/pairing.tsx` is reached from **Settings → Approve a TV** (not the home header):

1. Enter the code shown on the TV.
2. **Preview** → `POST /api/auth/device-pairing/preview` (device name/platform, shown with “Label set by the device”).
3. **Approve** → `POST /api/auth/device-pairing/complete`.

## Native push (when enabled)

Set `EXPO_PUBLIC_NATIVE_PUSH_ENABLED=1` only in builds where APNs/FCM delivery is live. Code must check `nativePushEnabled` from `src/features.ts` before calling `registerNativePushDevice` or requesting OS notification permission.
