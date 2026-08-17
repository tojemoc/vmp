# Native clients — promotion checklist

**Use this before** promoting `apps/mobile` into the root npm workspace **or** shipping the first TestFlight / internal Play track build.

**Named reviewer (hard gate):** every row must be **signed off in writing** (PR comment or checklist copy in the promotion PR) by the **repository maintainer** of `tojemoc/vmp` (GitHub org owner / primary CodeRabbit reviewer). Self-check by the implementing agent or a contributor is **not** sufficient.

Linked plan: [`native-clients-plan.md`](native-clients-plan.md).

## Workspace promotion (before joining root `packages/*` / CI)

| # | Blocker | Verify | Sign-off |
| --- | --- | --- | --- |
| W1 | Open PoC issues reviewed | All items in [Open PoC issues](native-clients-plan.md#open-poc-issues-track-before-store) have an owner or waiver | Maintainer |
| W2 | `@vmp/shared` drift | Mobile app builds against current shared types; no stale `file:` copy | Maintainer |
| W3 | Nx / CI target | `start`, `typecheck`, and lint targets exist and run in CI | Maintainer |
| W4 | Env documented | `EXPO_PUBLIC_API_URL`, push flag, and deep-link host documented for CI builds | Maintainer |

## Store / TestFlight / internal Play (blocking)

| # | Blocker | Verify | Sign-off |
| --- | --- | --- | --- |
| S1 | **2FA / TOTP UI** | Editors/admins can sign in natively, or staff testing is explicitly out of scope | Maintainer |
| S2 | **Landscape watch** | `app.json` no longer portrait-only, or waiver with UX sign-off | Maintainer |
| S3 | **Background audio policy** | Intentional setting documented; matches product expectation for long-form | Maintainer |
| S4 | **Approve TV placement** | Under Settings/profile — **not** a home-header primary action | Maintainer |
| S5 | **Universal Links / App Links** | AASA + Digital Asset Links live on production `FRONTEND_HOST`; verified with Apple/Google tools. **Owner:** repository maintainer (Cloudflare web Worker host) | Maintainer |
| S6 | **`vmp://` not primary** | Custom scheme stays **off** unless `EXPO_PUBLIC_ENABLE_VMP_SCHEME=1` (dev). Store build must not set that flag; HTTPS Universal/App Links only | Maintainer |
| S7 | **Cross-device magic link** | Login/error copy explains single-use + same-device. First store build: **copy-only** unless maintainer waives to explore token-binding | Maintainer |
| S8 | **TV pairing labels** | UI shows “Label set by the device”. Unverified labels accepted with that warning, or attestation added | Maintainer |
| S9 | **Native push delivery** | `EXPO_PUBLIC_NATIVE_PUSH_ENABLED=1` only when APNs/FCM send path is live in same release | Maintainer |
| S10 | **Pairing preview abuse** | Per-code **and** per-IP rate limits required **before any public announcement of pairing** (not only store submission). Endpoint is live in the API on merge. | Maintainer |

## Phase 0 pairing contract

Not frozen on merge of this PoC. **Additive** changes (new optional fields, new endpoints) are allowed through the Tier 2 TV PoC.

**Breaking** changes require a maintainer waiver in the PR that ships them. Breaking includes:

- Rename or remove endpoints / fields
- Newly **required** fields
- Authentication / authorization changes
- Lifecycle transitions (e.g. pending → approved → redeemed)
- Error semantics (status codes, `code` strings)
- Retry / **idempotency** behavior (including one-shot `poll` redeem: a successful `ready` response permanently consumes the code)
- Response shapes that existing clients depend on

Stability is declared when the Tier 2 PoC ships, not at Phase 0 merge.

## TV re-pair UX (lost `ready` poll)

**Accepted for Tier 2 PoC** (known testers): if the TV loses the HTTP response after the server marks the code redeemed, the user starts a new pairing flow (new code + phone re-approval).

**Idempotency ADR milestone:** write and decide **before public TV rollout** (after the Tier 2 known-tester PoC, **before** a store / living-room launch). Not required to start the Tier 2 PoC.

## PoC-only waivers (allowed until S-row promotion)

These are **not** blockers for merging Phase 0 API + Expo scaffold PRs, but **are** blockers for S1–S10 unless waived by the maintainer:

- Portrait-only + no background audio
- `vmp://` as primary deep link on dev devices
- Cross-device magic-link confusion (copy + error only)
- TV self-reported device labels
- Push token register without delivery (`nativePushEnabled` default off)

## Quick answers (Prelint open questions)

| Question | Answer |
| --- | --- |
| Named reviewer? | **Repository maintainer** of `tojemoc/vmp` (org owner / CodeRabbit reviewer). Written sign-off per row. |
| Pairing API frozen on merge? | **No.** Additive until Tier 2 PoC; breaking changes need maintainer waiver. |
| Re-pair UX accepted? | **Yes for Tier 2 PoC** — new code + phone re-approval. Idempotency ADR **before public TV rollout**. |
| Cross-device magic link (S7)? | **Copy-only for first store build** unless maintainer waives to explore token-binding. |
| AASA / Digital Asset Links owner? | **Repository maintainer** deploys on the Cloudflare web Worker host (`FRONTEND_HOST`) and verifies with Apple/Google tools (**S5**). |
| When does `vmp://` become dev-only? | **Default off.** Opt in with `EXPO_PUBLIC_ENABLE_VMP_SCHEME=1` for local PoC. Store builds must not set it (**S6**). |
| Unverified TV labels? | **S8** — UI caveat “Label set by the device”; attestation later |
| S10 when? | **Before public pairing announcement**, not only store submission — per-code limits ship with this API |
| Refresh body vs cookie? | Body preferred when both present. Web must not POST JSON `{ refreshToken }` to `/api/auth/refresh`. Header-keyed format is a later additive change (not required for this merge). |
