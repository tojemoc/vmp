# Club plan entitlements

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) → *In progress — Club plan entitlements*  
**Issue:** [#649](https://github.com/tojemoc/vmp/issues/649) / [TOJ-139](https://linear.app/tojemoc/issue/TOJ-139)  
**Status:** Concurrent playback (API + web), IRL events v1, and ad-free gate shipped; ads creatives still absent (flag defaults off)

## Product definition (360tka.sk / Stargaze heritage)

**Club** is **yearly billing with a higher price**, not a separate billing interval. On payment providers, club may share the same recurrence cadence as yearly (e.g. GoPay 12-month `MONTH` cycle) while `plan_type` stays `club` in D1 for entitlements and pricing.

Original marketing copy (paraphrased):

1. **IRL events** — invitations and free access to selected in-person events.
2. **Ad-free** — ad-free viewing if ads are ever added to the platform.

**Stargaze (legacy platform):** one **active device** could play **one video** at a time (hard limit). Club was intended to raise that to **two or three** concurrent streams per household/account.

### Not club entitlements

- **`offline_device_limit_club`** (`0037_offline_downloads.sql`) — caps how many devices can register for **offline download** licenses (default 5 vs club 10). This is abuse control for the PWA offline feature, **not** concurrent streaming. Do not conflate with Stargaze playback limits.

## Current VMP state

| Entitlement | Implemented? | Notes |
|-------------|--------------|-------|
| Distinct `plan_type = 'club'` | Yes | Subscriptions, checkout, admin pricing |
| Yearly-length period | Yes | `periodEndIsoForPlan` treats club like yearly (12 months) |
| Qerko legacy `subscriptionType: club` | Yes | Fixed: must not collapse to `yearly` on E-shop orders |
| GoPay / Comgate club checkout | Shipped | Club uses yearly recurrence where required; production hardening in `payments-gopay-comgate` |
| Concurrent playback limit | **Yes (flagged)** | API + web player mint/heartbeat/release + limit UI. `video-access` enforces when `concurrent_playback_enforced=1` (default `0`). Safe to enable in staging after this PR. |
| IRL event access | **Yes (v1)** | Admin CRUD + account RSVP + check-in token; club-only gate. Optional Brevo invites still future. |
| Ad-free playback | **Gate only** | `ads_enabled` admin flag + `hasAdFreeEntitlement` / watch-page slot. No ad creatives yet (flag defaults `0`). |

## 1. Concurrent playback limits (priority)

### Goals

- Enforce **max concurrent active playback sessions** per subscriber account.
- Defaults (configurable via `admin_settings`):
  - `monthly` / `yearly`: **1** active stream (Stargaze parity for standard plans).
  - `club`: **3** (product default; tune via `concurrent_playback_limit_club`).
- Staff roles (`editor`+): exempt or high cap (match offline-downloads staff bypass pattern in `offlineDownloads.ts`).

### Non-goals (v1)

- Per-device naming UI for stream slots.
- Geo-fencing or household detection beyond account JWT.
- Limiting **preview** / anonymous traffic (keep existing anon rate limits only).

### Suggested architecture

```text
Client (player)                    API Worker
     |                                  |
     |-- POST heartbeat / session ----->|  upsert playback_sessions
     |    (videoId, sessionId)          |  (user_id, session_id, video_id,
     |                                  |   last_seen_at, user_agent hash?)
     |-- GET video-access / proxy ----->|  count active sessions for user
     |                                  |  if count >= limit && !this session:
     |<-- 409 concurrent_limit ---------|      reject new stream OR steal oldest
```

**Session identity:** server-issued `sessionId` (UUID) from `POST /api/account/playback-sessions`, stored client-side (e.g. `sessionStorage`); sent on `video-access` and segment/manifest requests (header e.g. `X-VMP-Playback-Session` or signed query param on proxy URLs). Clients must not invent session ids — heartbeat/`video-access` only accept rows minted for `JWT.sub`. All session register/heartbeat/release endpoints require a valid Bearer JWT. **`playback_sessions` lookups must match both `sessionId` and `JWT.sub`** — never trust a `userId` embedded only in a signed proxy URL without verifying it equals the authenticated subject. Proxy enforcement must bind the session (and/or `JWT.sub`) into the signed URL payload or re-validate the bearer on authenticated proxy requests so a leaked playlist URL cannot play under another account.

**Active definition:** row in `playback_sessions` with `last_seen_at` within **90s** (configurable `concurrent_playback_stale_seconds`). Player sends heartbeat every **30s** while playing (pause/stop → DELETE or let stale expire).

**Enforcement points (pick one primary, one backup):**

1. **`GET /api/video-access/:videoId`** (preferred) — reject before issuing playlist URL when at cap and session not already registered.
2. **`/api/video-proxy/...`** — reject manifest/segment if session invalid (prevents URL sharing bypass). Must align with signed segment URLs (#4).

**Storage options:**

| Option | Pros | Cons |
|--------|------|------|
| D1 table `playback_sessions` | Simple, auditable, works on Workers | Needs periodic cleanup cron |
| Durable Object per user | Strong consistency, fast counting | New binding, migration path |

Recommendation: **D1** for v1 (consistent with `playback_positions`); revisit DO if race conditions appear under load.

### Schema sketch (D1)

```sql
CREATE TABLE playback_sessions (
  id TEXT PRIMARY KEY,              -- server-issued session UUID
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_playback_sessions_user_active ON playback_sessions(user_id, last_seen_at);
```

### API sketch

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/account/playback-sessions` | Bearer | Mint server-issued session + claim slot (`videoId`) |
| `PUT` | `/api/account/playback-sessions/:sessionId` | Bearer | Heartbeat (`videoId`, optional `ended: true` to release) |
| `DELETE` | `/api/account/playback-sessions/:sessionId` | Bearer | Explicit end |

`video-access` and proxy: when enforcement is on, require a valid server-issued session id for premium streams; return `409` + `{ code: 'playback_session_required' }` when missing/unknown, or `409` + `{ code: 'concurrent_playback_limit', limit: N }` when create exceeds the plan cap.

### Web (`@vmp/web`)

- `useVideoPlayer` / watch page: `POST` to mint `sessionId` on play, heartbeat while `playing`, release on `pause`/`ended`/`beforeunload`.
- User-facing copy when blocked: explain club allows more devices; suggest stopping another session or upgrading.

### Admin settings

| Key | Default | Description |
|-----|---------|-------------|
| `concurrent_playback_enforced` | `0` | When `1`, enforce concurrent playback limits; `0` ships schema/API disabled (safe rollout) |
| `concurrent_playback_limit_default` | `1` | monthly + yearly |
| `concurrent_playback_limit_club` | `3` | club plan |
| `concurrent_playback_stale_seconds` | `90` | session TTL without heartbeat |

### Tests

- Unit: limit resolution by `plan_type`; stale session exclusion from count.
- Integration: N sessions allowed for club, N+1 rejected; monthly capped at 1.
- Player: heartbeat sent while playing; session cleared on navigate away.

### Rollout

1. Ship schema + API behind `admin_settings.concurrent_playback_enforced` (`0` default).
2. Enable in staging; monitor 409 rate.
3. Enable production; document in account FAQ.

---

## 2. IRL event access

- Admin: create events, capacity, club-only flag, publish, check-in by token (`/admin` → IRL events).
- Account: list upcoming published events, RSVP, show check-in token.
- Optional Brevo email for invitations remains future work.

---

## 3. Ad-free playback

- Global `ads_enabled` (`admin_settings`, System → Feature toggles; also exposed on `GET /api/site-settings`).
- `hasAdFreeEntitlement` / `shouldShowAds` in `@vmp/shared` → club plan or staff.
- Watch page mounts an empty `data-testid="watch-ad-slot"` only when ads should show; no creatives yet.

---

## Checklist (copy to ROADMAP when implementing)

- [x] D1 migration `playback_sessions` + admin_settings keys ([#655](https://github.com/tojemoc/vmp/pull/655))
- [x] API: session mint / heartbeat / release ([#655](https://github.com/tojemoc/vmp/pull/655), [#661](https://github.com/tojemoc/vmp/pull/661))
- [x] Enforce on `video-access` when `concurrent_playback_enforced=1` ([#655](https://github.com/tojemoc/vmp/pull/655), [#661](https://github.com/tojemoc/vmp/pull/661))
- [x] Web player session mint + heartbeats + limit error UI
- [x] API tests; flag defaults to `concurrent_playback_enforced=0`
- [x] IRL events v1 (admin CRUD + account RSVP + check-in)
- [x] Ad-free gate (`ads_enabled` + club/staff skip; creatives deferred)
