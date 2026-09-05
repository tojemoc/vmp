# Step 8 — Brevo newsletter sync

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) → *Step 8*  
**Issue:** [#645](https://github.com/tojemoc/vmp/issues/645)  
**Status:** In progress (PR #657)

## Scope

- `packages/api/src/brevo.ts` — sync **paying** subscribers (`active` / `trialing`) to a Brevo **marketing** list, unless they have opted out of the newsletter.
- **Opt-out model (not opt-in):** by default, a paid subscription includes the creator newsletter. Checkout and account expose an unchecked checkbox: *“I do not want to receive any newsletter from the creator.”* Checking it stamps `users.newsletter_opted_out_at` and removes the contact from the marketing list only.
- **System / security mail stays separate:** magic links, billing, and account notices use Brevo transactional SMTP and are never gated by newsletter preference. Opting out of the newsletter must not suppress those messages.
- **Preserve Brevo-side state:** respect existing unsubscribe / suppression / blocklist flags from Brevo API responses; do not re-subscribe contacts Brevo marks as unsubscribed unless the user clears opt-out in-product and is still paying.
- **Cancellation semantics:** leaving `active`/`trialing` removes marketing-list membership (newsletter is for current paying subscribers). Opt-out also removes membership while still paying.
- Stripe (and other provider) webhooks: on subscribe/renewal, sync when not opted out; on cancel / non-paying, remove from the list.
- Checkout: `POST /api/payments/checkout` accepts optional `newsletterOptOut: boolean` and persists it before creating the payment session.
- Account: `GET` / `PUT /api/account/newsletter-preference` with `{ optedOut }`.
- Admin Newsletter tab: compose subject + body, preview as HTML, send via Brevo campaign API. Requires `admin` or `super_admin` role (NOT editor).
- Store `brevo_subscriber_list_id` in `admin_settings`.

## Checklist

- [ ] Newsletter opt-out model (`newsletter_opted_out_at` + account / checkout control)
- [ ] Brevo sync helper (`add` for paying non-opted-out; `remove` on opt-out or non-paying; honor Brevo suppressions)
- [ ] Webhook hooks on subscribe, renewal, cancel (preference-aware)
- [ ] Admin Newsletter UI + send campaign API
- [ ] `brevo_subscriber_list_id` in admin settings
- [ ] Tests + staging smoke with `BREVO_API_KEY`
