# Step 8 — Brevo newsletter sync

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) → *Step 8*  
**Status:** Not started

## Scope

- `packages/api/src/brevo.js` — sync paying subscribers to a Brevo contact list; remove on cancellation.
- Call sync from Stripe webhook on `checkout.session.completed` and renewal; call remove on `customer.subscription.deleted`.
- Admin Newsletter tab: compose subject + body, preview as HTML, send via Brevo campaign API. Requires `admin` or `super_admin` role (NOT editor).
- Store `brevo_subscriber_list_id` in `admin_settings`.

## Checklist

- [ ] Brevo sync helper (`add` / `remove` list membership)
- [ ] Webhook hooks on subscribe, renewal, cancel
- [ ] Admin Newsletter UI + send campaign API
- [ ] `brevo_subscriber_list_id` in admin settings
- [ ] Tests + staging smoke with `BREVO_API_KEY`
