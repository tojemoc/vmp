# Admin draft video preview by UUID

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) → *Admin draft video preview* (`admin-draft-video-preview`)  
**Issue:** [#723](https://github.com/tojemoc/vmp/issues/723)  
**Status:** In progress

## Goal

Editors, admins, and super_admins must be able to open a **draft** (or other unpublished) video at `/watch/{uuid}` for full-playback verification **before** publishing. Viewers, anonymous users, and crawlers must still get **404** for unpublished videos.

## Background

- `GET /api/video-access/{id}` already grants staff full access to unpublished rows when the JWT role is administrative.
- The watch page loads `GET /api/videos/{id}/meta` first and treats a **404** as terminal “video not found”, so it never calls video-access for drafts.
- Public meta intentionally returns 404 for non-`published` rows (SEO / OG crawlers).
- Admin UI only offered an external watch link when a vanity **slug** was set (usually after publish).

## Contract

### Roles

Content editors only: `editor` | `admin` | `super_admin` (same set as `canEditContent` / `requireRole(..., 'editor', 'admin', 'super_admin')`).

Analyst / moderator / viewer / anonymous: unpublished remains **404**.

### `GET /api/videos/:idOrSlug/meta`

| Caller | Published | Draft / archived / scheduled-not-live |
|--------|-----------|----------------------------------------|
| Unauthenticated / viewer | 200 (if live) | 404 |
| editor / admin / super_admin (Bearer JWT) | 200 | **200** with `publish_status` |

Response additions for staff-visible rows:

- `publish_status`: `draft` | `published` | `archived` | …
- `staffPreview`: `true` when the row is not publicly live

Public response shape otherwise unchanged. Crawlers without a staff JWT still get 404 for drafts (no title/description leak).

### `GET /api/video-access/:videoId`

Unpublished rows: allow only content-editor roles (tighten from broader `isAdministrativeRole` for this gate). Staff continue to receive full `hasAccess` + signed playlist.

### Watch UI (`/watch/:videoId`)

- Send `Authorization` on meta when a session exists.
- If public meta 404s but the user `canEditContent`, still call video-access (client auth often available after SSR).
- Show a non-indexed **Draft preview** (or archived) banner when `staffPreview` / unpublished.
- `noIndex: true` for staff previews.

### Admin UI

- **Preview** action on draft (and other non-published) videos → `/watch/{uuid}` in a new tab.

## Checklist

- [x] `isContentEditorRole` helper + tests
- [x] Staff-aware `/api/videos/:id/meta`
- [x] Unpublished video-access gated to content editors
- [x] Watch page: auth meta + staff bypass + banner + noindex
- [x] Admin **Preview** link by UUID
- [x] Automated tests for role / meta visibility helpers
