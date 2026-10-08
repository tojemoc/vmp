# Handoff prompt — vmp-infra Phase 1a (Mosaiq domains & pooled Worker shells)

**Status:** Applied (DNS, Worker shells, `TENANT_REGISTRY_KV`, CF for SaaS, redirects).  
**Next:** [vmp-infra-handoff-mosaiq-data-plane.md](./vmp-infra-handoff-mosaiq-data-plane.md) (D1, billing, queues, bindings).

Historical prompt kept for audit. Original body below.

---

## Context

You are editing the private **`vmp-infra`** repo (Terraform, `tenants/*.json`, Looking Glass). Application code lives in **`tojemoc/vmp`** (soon possibly `moltenmarshmallows/mosaiq*`).

App-side design (read-only reference once merged): `docs/plans/mosaiq-multi-tenant.md` in the vmp repo.

**Boundary reminder:** `vmp-infra` Terraform owns Cloudflare platform resources (DNS **and** Workers/D1/KV/…); it must **not** become a required PR for every Start-tier channel signup. Wildcard / CF for SaaS is configured once; runtime tenant rows live in app D1 + KV.

## Cloudflare account

Use Mosaiq account **`5b594173256386996fe1e03fd5cea3f8`** for platform prod/staging Workers and DNS. Do not keep new Mosaiq prod on the legacy VMP account (`8298ebe2…` in current app wrangler)—cutover means Workers are created/deployed in the Mosaiq account (app CD will follow).

## Domains to wire

| Domain | Intent |
|--------|--------|
| `mosaiq.video` | Marketing landing (www + apex). Placeholder OK. |
| `app.mosaiq.video` | First production **product** hostname (Nuxt web Worker). |
| `staging.app.mosaiq.video` | Staging product hostname (replaces `vmp.tjm.sk`). |
| `api.mosaiq.video` | API Worker public hostname (unless same-origin is chosen later). |
| `staging.api.mosaiq.video` | Staging API. |
| `platform.mosaiq.video` | Looking Glass / operator entry (CNAME/redirect to Vercel Looking Glass is fine). |
| `moltenmarshmallows.com` | Corporate site only. |
| `moltenmarshmallo.ws` + `www` | **301/302 →** `https://moltenmarshmallows.com`. |
| `sites.moltenmarshmallo.ws` | Cloudflare for SaaS **fallback origin** for future custom tenant domains (point at web Worker). |
| Optional `media.moltenmarshmallo.ws` | Reserve only; video-proxy Option B is not now. |

Also plan (do not block Phase 1): wildcard or registry-managed `*.mosaiq.video` for future `{channel}.mosaiq.video` Start-tier hosts **without** per-signup Terraform.

## What to implement in Terraform / DNS now

1. **Dual NS** (already in progress per repo README): `mosaiq.video`, `moltenmarshmallows.com`, `moltenmarshmallo.ws`.
2. **Records** for `app`, `staging.app`, `api`, `staging.api`, `platform`, marketing apex/www, corporate, and `.ws` redirects.
3. **Worker routes / custom domains** in the Mosaiq account for:
   - web Worker (names TBD with app: today `vmp-web-worker-dev` / `vmp-web-worker-prod`—may rename later to `mosaiq-web-*`)
   - API Worker (`vmp-api` → eventually `mosaiq-api`)
   - billing Worker stays bound to API via service binding (no public hostname required)
4. **CF for SaaS** bootstrap: fallback origin `sites.moltenmarshmallo.ws` → web Worker. Do not require per-customer Terraform after this exists.
5. **KV namespace** stub for `TENANT_REGISTRY_KV` (hostname → tenant JSON) shared by API (and later video-proxy). Document binding name for the app wrangler handoff.
6. **Do not** put Stripe/JWT secrets in git; keep SECRETS.md flow. App CD/`wrangler secret` remains source for Worker secrets unless you already centralize them.

## Explicit non-goals for this infra pass

- Self-serve signup automation.
- Per-tenant D1 databases.
- W4P dispatch (Enterprise) — keep modules modular only.
- Decommission automation for `*.tjm.sk` (app/ops can tear down after Mosaiq smoke; optional DNS cleanup note is enough).

## Deliverables back to app team

Please reply with:

1. Final hostname list actually created.
2. Worker names + routes in account `5b594173…`.
3. KV namespace id for `TENANT_REGISTRY_KV`.
4. CF for SaaS status (fallback hostname, ownership verification steps).
5. Values to put in GitHub Actions vars: `FRONTEND_URL_STAGING/PROD`, `API_URL_STAGING/PROD`, suggested `ALLOWED_ORIGINS`.
6. Any account/permission gaps blocking app `wrangler deploy` into this account from GitHub Actions.

## Acceptance

- `https://app.mosaiq.video` and `https://api.mosaiq.video` (or staging equivalents) resolve to Cloudflare and are ready for the first app deploy from `tojemoc/vmp`.
- `moltenmarshmallo.ws` apex/www redirect to corporate.
- Looking Glass reachable via `platform.mosaiq.video` or documented temporary URL.
- Signup path for future channels does **not** require a new Terraform apply (wildcard or SaaS documented).
