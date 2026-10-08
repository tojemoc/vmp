# Handoff — vmp-infra: fix failed Phase 1b apply

Copy below to the **vmp-infra** agent. App cutover is blocked until apply is green and `terraform output -json app_handoff` returns real ids.

---

## Context

`terraform apply` on `terraform/environments/mosaiq` **failed** (CI apply job). Phase 1a resources already exist in Route53/Cloudflare, but this apply tried to **create** them again and also hit **token permission** gaps for R2 and Rulesets.

Partial creates that **did** succeed (may need import if not in state after failed apply):

| Resource | Id / name |
|----------|-----------|
| D1 `video-subscription-db` | `1d62f88d-35b6-479b-85ba-234b7cefd3fd` |
| KV `RATE_LIMIT_KV` | `24a5bb09a557407eb8a90c491ab08966` |
| Queue `vmp-push-delivery` | `f25b81a5a7d94201b1010db710e0ec40` |
| Queue `vmp-replication-events` | `2200fd91e34647959ff1095672757349` |

## Root causes (from log)

1. **State ↔ reality skew:** Many “already exists” errors for DNS (R53 + CF), `TENANT_REGISTRY_KV`, Worker routes (`moltenmarshmallo.ws/*`, `www.…`), SaaS `sites`/`customers`. Resources from an earlier apply are live but **not in the TF state** this job used (or were created outside this state). `allow_overwrite = false` makes recreate fatal.
2. **R2:** `failed to create R2 bucket` → `Authentication error (10000)` — API token lacks **Workers R2 Storage Edit** (or correct account scope).
3. **Ruleset:** `error creating ruleset moltenmarshmallo-ws-redirect` → `request is not authorized` — token lacks Zone **Rulesets** / dynamic redirect permission on `moltenmarshmallo.ws`.

## Required fixes

### A. Import / adopt orphans (do not destroy live DNS)

For every resource that errored “already exists”, **import** into state (or use `terraform import` / data sources + `moved` blocks). Priority list:

- `cloudflare_workers_kv_namespace.tenant_registry[0]` (title `TENANT_REGISTRY_KV`)
- All `aws_route53_record.platform_product[*]`, `pooled_worker[*]`, `saas_*`, `ws_*`, `platform_txt[gh-org-*]`
- Matching `cloudflare_record.*` for the same hostnames
- `cloudflare_workers_route.saas_zone_exclude_apex[0]` / `exclude_www[0]`
- SaaS module `fallback_origin` / `cname_target` records
- Partial: D1, `RATE_LIMIT_KV`, both queues if state did not commit them

Optional: set `allow_overwrite = true` on dual-NS records **only** if import is impractical; prefer import.

### B. Widen `CLOUDFLARE_API_TOKEN` (see SECRETS.md)

Add / verify:

- Account: Workers Scripts, Workers KV, **D1**, **Queues**, **R2 Storage Edit**
- Zone (all three platform zones): DNS Edit, Workers Routes, SSL, **Rulesets** (or “Zone WAF / Transform Rules” equivalent for `http_request_dynamic_redirect`)

### C. Re-apply

- `terraform plan` should show remaining creates: billing Workers, API/web scripts+bindings, Worker custom domains, SaaS custom hostname, ruleset (after token fix) — **not** recreate of imported DNS, and **no R2 bucket** (storage is B2-only; `manage_r2=false`).
- Green apply → publish `terraform output -json app_handoff` (and update `docs/MOSAIQ_APP_HANDOFF.md` with concrete D1/KV ids).

## Deliverables back to app (`tojemoc/vmp`)

1. Confirmation apply succeeded.
2. Full `app_handoff` JSON (especially `d1.database_id`, both KV ids, `worker_content_ignored_after_apply`, billing binding targets).
3. Note whether R2 was created or temporarily `manage_r2=false` (B2-only).
4. Any leftover manual dashboard steps.

## Acceptance

- [ ] `terraform apply` exit 0
- [ ] No “already exists” on next plan for imported resources
- [ ] R2 exists **or** documented B2-only
- [ ] `.ws` apex/www redirect ruleset present
- [ ] App can start Phase 1c with pasted `app_handoff`
