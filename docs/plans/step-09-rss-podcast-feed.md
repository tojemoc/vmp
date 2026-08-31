# Step 9 — RSS / podcast feed

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) → *Step 9*  
**Status:** Not started

## Scope

- Per-user stable RSS token: `HMAC-SHA256(RSS_SECRET, 'rss:' + userId)`.
- `GET /api/feed/:userId/:token` — validates token + active subscription, returns RSS 2.0 with iTunes podcast tags for all published videos.
- Account page section with copyable RSS URL and instructions.
- Public listing feed: `GET /api/feed/public` — stable URL for directory submission; always serves **preview-only** enclosures.
- Account helper: `GET /api/account/rss` (auth required) — returns `{ publicUrl, personalUrl }` for copy/paste into podcast apps.

## Checklist

- [ ] RSS token signing + validation
- [ ] Personal feed endpoint (full access subscribers)
- [ ] Public preview-only feed
- [ ] `GET /api/account/rss` helper
- [ ] Account page RSS section (copy URLs + instructions)
- [ ] Tests + feed validator smoke
