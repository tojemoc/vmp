# TV clients — first usability sprint (Tier 2)

**Roadmap ID:** `tv-tier2-sprint`  
**Parent:** [Native / TV clients](../native-clients-plan.md) (`native-clients`, [#647](https://github.com/tojemoc/vmp/issues/647))  
**Depends on:** Phase 0 device-pairing APIs (already shipped); phone “Approve a TV” screen in `apps/mobile`

## Goal

Make tvOS / Android TV builds **usable with a remote**: focus navigation, pairing-code login, and basic catalog → watch. Voice control and full PWA parity are explicitly later.

## Sprint 0 scope (first TV-usable cut)

| Workstream | Deliverable |
| --- | --- |
| **Platform** | `react-native-tvos` (or current RN-tv fork agreed in native plan) sharing `apps/mobile` business logic; separate TV entry / screen set where touch layouts fail |
| **Auth** | Pairing-code login UI on TV: `POST /api/auth/device-pairing/start` → show code → poll per plan guidance (local format gate, `expiresAt` bound, non-validating pending UX) |
| **Phone half** | Keep / harden Settings → Approve a TV (`preview` + `complete`) |
| **Focus UI** | D-pad / arrow focus for: login waiting, catalog grid, watch transport (play/pause, back). Prefer `react-tv-space-navigation` or platform Focus APIs |
| **Playback** | System / native TV player for one HLS VOD from existing video-access + proxy |
| **Entitlement** | Same subscriber gate as phone Milestone A unless product decides TV is subscriber-only longer |

### Explicit non-goals for Sprint 0

- Voice search / voice remote commands
- Tizen / webOS (Tier 3)
- In-TV magic-link email
- Full CMS homepage parity on TV
- Offline downloads on TV
- MoQ livestreams on TV

## Later (after Sprint 0)

1. Focus-safe settings + sign-out + re-pair
2. Recommendations / “Up next” with focus
3. Better player chrome (subtitles, audio tracks) via platform APIs
4. **Voice control** — platform speech intents / assistant deep links; only after remote UX is solid
5. Tier 3 PoC (one of Tizen or webOS) using the same pairing contracts

## Acceptance (Sprint 0)

1. Fresh TV install shows a pairing code without a keyboard.
2. Approving from the phone app yields a session on the TV.
3. User can move focus with the directional pad through ≥5 catalog items and open watch.
4. Back exits watch to catalog; session survives app backgrounding (refresh token in secure storage).

## Implementation notes (Android TV)

- Same Expo app as Tier 1 (`apps/mobile`) with `react-native: npm:react-native-tvos@0.86-stable` and `@react-native-tvos/config-tv`.
- Phone builds: unset `EXPO_TV`. Android TV CI / local: `EXPO_TV=1` + `npx expo prebuild --platform android --clean`.
- Workflow: `.github/workflows/mobile-artifacts.yml` input `build_android_tv` → artifact `mobile-android-tv-apk`.
- Sideload: `adb install -r vmp-android-tv-*.apk` on a Google TV / Android TV device or emulator.

## Decision log

- **2026-09:** Track an explicit first TV sprint on the roadmap so Tier 2 is not “someday” after phone polish; voice stays a post-usability enhancement.
- **2026-09:** Ship Android TV Sprint 0 first (leanback APK + pairing + D-pad catalog/watch); tvOS CI follows when a TV SDK macOS runner is available.
