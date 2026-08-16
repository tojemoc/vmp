# VMP mobile (Tier 1 PoC)

Expo (React Native) phone/tablet client. Plan: [`docs/native-clients-plan.md`](../../docs/native-clients-plan.md).

## Status

Scaffold + API client for Phase 0 / Tier 1 PoC:

- Magic-link request → deep-link redeem via `POST /api/auth/native/redeem`
- Secure session storage (`expo-secure-store`)
- Catalog + watch skeleton (`expo-video`)
- Native push token register stub (`POST /api/push/device`)

Not yet: TestFlight/Play builds, AASA live hosts, offline download UI, APNs/FCM send path.

## Why not an npm workspace member?

Root `package.json` workspaces are `packages/*` only. This app lives under `apps/mobile` so Expo’s dependency tree does not force a root lockfile rewrite during the PoC. Install locally:

```bash
cd apps/mobile
npm install
npx expo start
```

Point the app at a local API:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8787 npx expo start
```

## Deep links

| Scheme | Example |
| --- | --- |
| Custom | `vmp://auth/verify?token=…` |
| Universal / App Link | `https://<FRONTEND_HOST>/auth/verify?token=…` |

Replace `REPLACE_WITH_FRONTEND_HOST` in `app.json` before store builds. Publish Apple `apple-app-site-association` and Android Digital Asset Links on that host.

## Pairing (Tier 2+)

API already exposes `/api/auth/device-pairing/*`. This phone app will later add an “Approve TV” screen that calls `complete` while logged in.
