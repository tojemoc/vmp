# Browser console messages (VMP web)

Reference for common console output on `vmp.tjm.sk` and client instances. Not every message is a bug.

## Vercel Web Analytics (`/_vercel/insights/script.js`)

**Status:** Removed in [#384](https://github.com/tojemoc/vmp/pull/384) — `@vercel/analytics` is no longer in `packages/web`.

If you still see:

```text
GET …/_vercel/insights/script.js 404
[Vercel Web Analytics] Failed to load script…
```

the browser is running an **older JS bundle**, not current `main`:

1. **Service worker cache** — PWA uses Workbox with `registerType: 'prompt'`. Hard-refresh or unregister the service worker (DevTools → Application → Service workers → Unregister), then reload.
2. **Stale deployment** — Confirm staging/production was deployed after the #384 merge (push to `main` triggers staging CD).
3. **Backup hostname** — Failover to a Vercel-hosted build would 404 that path on Cloudflare Pages; primary analytics are Umami (GTM gateway) and Sentry.

No code change is required once clients pick up a post-#384 build.

## Hydration mismatch

```text
Hydration completed but contains mismatches.
```

Vue warns when server-rendered HTML differs from the first client render. Known causes we guard against:

| Cause | Mitigation |
|-------|------------|
| PWA install banner (`showPwaBanner`) | Banner only shown after `onMounted` (`pwaBannerReady`) so SSR and first paint match |
| Color mode | `@nuxtjs/color-mode` injects a head script; mismatches here are usually theme-related in dev |
| Viewport-dependent homepage layout | `isMobileViewport` updates after mount (layout may shift once, but should not mismatch if both start at `false`) |

If mismatches persist after a hard refresh, reproduce with Vue DevTools or `debug` hydration logging and note the component named in the expanded stack.

## PWA install banner (Edge)

```text
Banner not shown: beforeinstallpromptevent.preventDefault() called…
```

**Expected.** `@vite-pwa/nuxt` with `installPrompt: true` calls `preventDefault()` so the app can show its own install UI. The native Chromium banner is suppressed until the user clicks **Install** in our banner.

## Tracking Prevention (Edge)

```text
Tracking Prevention blocked access to storage for <URL>.
```

Edge privacy feature blocking third-party or cross-site storage (Stripe, GTM, Sentry, etc.). Usually harmless; test in a normal window or adjust Edge tracking settings. Not fixable in app code without changing providers.

## Debug logging removed

Development-only `console.log` prefixes (`[PWA DETECT]`, `[ROUTE AUTH]`, `[AUTH ENTRY]`, `[NAVBAR]`, `[PWA WIZARD]`) were removed or gated so production consoles stay quiet.
