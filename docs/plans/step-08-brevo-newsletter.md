# Step 8 — Brevo newsletter sync

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) → *Step 8*  
**Issue:** [#645](https://github.com/tojemoc/vmp/issues/645)  
**Status:** Not started

## Scope

- `packages/api/src/brevo.js` — sync contacts to a Brevo marketing list when **explicit marketing consent** is granted; do **not** conflate payment status with newsletter opt-in.
- Store per-user marketing consent separately from subscription billing (e.g. `users.newsletter_consent_at` / consent version, or dedicated table). Only add to the Brevo list when consent is present and not withdrawn.
- **Preserve Brevo-side state:** respect existing unsubscribe / suppression / blocklist flags from Brevo API responses; do not re-subscribe contacts Brevo marks as unsubscribed unless the user re-grants consent in-product.
- **Cancellation semantics:** treat subscription cancellation as a **billing transition**, not automatic newsletter removal, unless product policy explicitly requires *active-paying-only* list eligibility. If paying-only is required, remove list membership on cancel but **do not** delete the Brevo contact or override a user’s marketing unsubscribe.
- Stripe (and other provider) webhooks: on subscribe/renewal, sync **only when marketing consent exists**; on cancel, adjust list membership per policy above — not a blind `removeSubscriberFromNewsletter` on every `customer.subscription.deleted`.
- Admin Newsletter tab: compose subject + body, preview as HTML, send via Brevo campaign API. Requires `admin` or `super_admin` role (NOT editor).
- Store `brevo_subscriber_list_id` in `admin_settings`.

## Checklist

- [ ] Marketing consent model (separate from subscription status)
- [ ] Brevo sync helper (`add` / conditional `remove` list membership; honor Brevo suppressions)
- [ ] Webhook hooks on subscribe, renewal, cancel (consent-aware)
- [ ] Admin Newsletter UI + send campaign API
- [ ] `brevo_subscriber_list_id` in admin settings
- [ ] Tests + staging smoke with `BREVO_API_KEY`
