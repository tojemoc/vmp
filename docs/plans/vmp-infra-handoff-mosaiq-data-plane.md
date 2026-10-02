# Handoff prompt — vmp-infra Phase 1b (CF data plane)

Phase 1a (DNS, Worker shells, `TENANT_REGISTRY_KV`, CF for SaaS, redirects) is **already applied**.  
Copy everything below the line to the agent working in **`vmp-infra`**.

---

## Context

You are extending **`vmp-infra` Terraform** so it owns **Cloudflare apps/services**, not only DNS.

Application code still lives in **`tojemoc/vmp`**. App CD will `wrangler deploy` **content** and put **secrets**; Terraform must create the resources and bindings those deploys attach to.

Design reference: `docs/plans/mosaiq-multi-tenant.md` in vmp (`vmp-infra ↔ app ownership`).

Account: **`5b594173256386996fe1e03fd5cea3f8`**.

## Goal

Make the Mosaiq account able to run a full staging + prod stack from app CD without manual dashboard clicks for D1/KV/Queues/billing.

## Create / wire in Terraform

### Workers (shells if missing; bindings always)

| Name | Role | Public host |
|------|------|-------------|
| `vmp-api` | API prod | `api.mosaiq.video` (exists) |
| `vmp-api-staging` | API staging | `staging.api.mosaiq.video` (exists) |
| `vmp-web-worker-prod` | Web prod | `app.mosaiq.video` (exists) |
| `vmp-web-worker-dev` | Web staging | `staging.app.mosaiq.video` (exists) |
| `vmp-billing` | Billing staging (service binding only) | none |
| `vmp-billing-prod` | Billing prod (service binding only) | none |

- Placeholder `fetch` 503 is fine.
- On Worker script resources: **`lifecycle { ignore_changes = [content, module, …] }`** (or equivalent) so app `wrangler deploy` does not fight Terraform forever.
- API Workers: service binding **`BILLING`** → `vmp-billing` (staging) / `vmp-billing-prod` (prod), entrypoint **`BillingService`** (matches `@vmp/billing`).

### D1

- One shared DB for pooled Start/Pro (name suggestion: `video-subscription-db` or `mosaiq-pooled`).
- Bind as `video_subscription_db` on **api** and **billing** (staging + prod Workers).
- Output **database_id** in `app_handoff`.
- Do **not** create per-tenant D1 databases.

### KV

| Binding | Title / purpose |
|---------|-----------------|
| `TENANT_REGISTRY_KV` | Exists — keep; output **id** |
| `RATE_LIMIT_KV` | Create if missing; bind to API Workers (segment limits) |

### Queues (API)

Mirror current app wrangler:

- `vmp-replication-events` (producer + consumer on API)
- `vmp-push-delivery` (producer + consumer on API)

Bind producers as `vmp_replication_events` / `vmp_push_delivery`.

### R2

- Bucket e.g. `vmp-videos` (or `mosaiq-videos`) bound as `BUCKET` on API + billing, **or**
- Explicitly document **B2-only** (no R2) if Mosaiq prod will not use R2 — then omit bucket but keep storage secrets on Workers via secret pipeline.

### Plain vars (staging vs prod)

Set on API / billing / web as appropriate (values from existing `app_handoff`):

- `API_URL`, `FRONTEND_URL`, `ALLOWED_ORIGINS`
- `SENDER_EMAIL` / `SENDER_NAME` (Mosaiq-branded defaults OK)
- `POSTHOG_HOST` if used

Do **not** put secrets in TF state as plaintext if avoidable; JWT/Stripe/B2/VAPID stay `wrangler secret` / secret store.

### Optional but helpful

- Flagship binding if Mosaiq account has an app id (else leave for app).
- Durable Object class registrations are usually created on first `wrangler deploy` with migrations — document that app owns DO migration tags; TF need not invent DO namespaces unless you already have a pattern.
- `cloudflare_workers_subdomain` / workers.dev enablement still needed for failover notes.

## Explicit non-goals

- Per-channel Terraform for `{slug}.mosaiq.video`
- Migrating legacy account `8298ebe2…` data automatically (separate cutover)
- Uploading real Nuxt/API bundles from Terraform
- W4P / Enterprise dispatch

## Deliverables back to app team

Update `docs/MOSAIQ_APP_HANDOFF.md` / `terraform output -json app_handoff` with:

1. All Worker names (including billing).
2. D1 `database_id` + name.
3. KV ids: `TENANT_REGISTRY_KV`, `RATE_LIMIT_KV`.
4. Queue names.
5. R2 bucket name **or** “B2-only, no R2”.
6. Confirmation `BILLING` service binding exists on both API Workers.
7. Confirmation Worker script `content` is ignored after apply (so CD is safe).
8. Any token permission gaps (D1 Edit, Queues, Workers Scripts, KV, Account Settings).

## Acceptance

- Fresh Mosaiq account can receive `wrangler deploy` from `tojemoc/vmp` for api + billing + web (staging + prod naming as above) with **only** secrets + code from CD.
- `https://staging.api.mosaiq.video` / `https://api.mosaiq.video` still resolve; billing has no public hostname.
- No dashboard-only resources required for the happy path (except secret values and optional Flagship app creation).
