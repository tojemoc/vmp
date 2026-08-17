# Native clients — promotion checklist

**Use this before** promoting `apps/mobile` into the root npm workspace **or** shipping the first TestFlight / internal Play track build. Every row must be checked or explicitly waived by a maintainer.

Linked plan: [`native-clients-plan.md`](native-clients-plan.md).

## Workspace promotion (before joining root `packages/*` / CI)

| # | Blocker | Verify |
| --- | --- | --- |
| W1 | Open PoC issues reviewed | All items in [Open PoC issues](native-clients-plan.md#open-poc-issues-track-before-store) have an owner or waiver |
| W2 | `@vmp/shared` drift | Mobile app builds against current shared types; no stale `file:` copy |
| W3 | Nx / CI target | `start`, `typecheck`, and lint targets exist and run in CI |
| W4 | Env documented | `EXPO_PUBLIC_API_URL`, push flag, and deep-link host documented for CI builds |

## Store / TestFlight / internal Play (blocking)

| # | Blocker | Verify |
| --- | --- | --- |
| S1 | **2FA / TOTP UI** | Editors/admins can sign in natively, or staff testing is explicitly out of scope |
| S2 | **Landscape watch** | `app.json` no longer portrait-only, or waiver with UX sign-off |
| S3 | **Background audio policy** | Intentional setting documented; matches product expectation for long-form |
| S4 | **Approve TV placement** | Not a top-level home header action — moved to settings/profile |
| S5 | **Universal Links / App Links** | AASA + Digital Asset Links live on production `FRONTEND_HOST`; verified with Apple/Google tools |
| S6 | **`vmp://` not primary** | Custom scheme is dev-only fallback; store build relies on verified HTTPS deep links |
| S7 | **Cross-device magic link** | Login/error copy explains single-use + same-device; known limitation accepted or token strategy improved |
| S8 | **TV pairing labels** | Unverified `deviceName` / `devicePlatform` accepted with warning, or attestation added |
| S9 | **Native push delivery** | `EXPO_PUBLIC_NATIVE_PUSH_ENABLED=1` only when APNs/FCM send path is live in same release |
| S10 | **Pairing preview abuse** | Preview endpoint rate-limited per code (not only per IP) if exposed to production traffic |

## PoC-only waivers (allowed until S-row promotion)

These are **not** blockers for merging Phase 0 API + Expo scaffold PRs, but **are** blockers for S1–S10:

- Portrait-only + no background audio
- Approve TV in home header
- `vmp://` as primary deep link on dev devices
- Cross-device magic-link confusion (copy + error only)
- TV self-reported device labels
- Push token register without delivery (`nativePushEnabled` default off)

## Quick answers (Prelint open questions)

| Question | Answer |
| --- | --- |
| Single checklist? | **This file.** |
| Cross-device magic link at promotion? | **S7** — accepted limitation with copy, unless token-binding ships |
| When does `vmp://` become dev-only? | **At first store/TestFlight build (S6)** — HTTPS Universal/App Links required |
| Unverified TV labels? | **S8** — waivable for Tier 2 PoC; revisit before broad TV rollout |
