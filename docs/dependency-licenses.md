# Dependency license notes

This repository is licensed under **GPL-2.0-only** (`LICENSE`). License scanners that flag the
`vmp` package itself for GPL are correctly describing the project license, not a third-party
surprise.

## Flagged packages (assessment)

| Package | Scanner flag | Assessment |
|---|---|---|
| `vmp` (this repo) | GPL-2.0-only | **Expected.** Project license. |
| `node-forge` | GPL-2.0-only / GPL-1.0-only | **Dual-licensed** `(BSD-3-Clause OR GPL-2.0)`. Scanners often surface only the GPL option. Used transitively by `listhen` → `@nuxt/cli` (local HTTPS for Nuxt CLI), not shipped in Cloudflare Worker production bundles. |
| `@dr.pogodin/react-native-static-server` | gpl-3.0-plus WITH autoconf-macro-exception | **npm package license is MIT.** The flag typically comes from native/Lighttpd autoconf macros or bundled third-party sources inside the native build, not the JS wrapper. Required for offline HLS on iOS (AVPlayer rejects `file://`). Keep until a MIT/Apache loopback server alternative is validated. |
| `@img/sharp-libvips-*` / `@img/sharp-wasm32` / `@img/sharp-win32-*` | LGPL-3.0-or-later | **LGPL** native binaries pulled transitively by Wrangler/Miniflare (`sharp`). Dynamic linking / optional platform packages; not redistributed as a modified libvips. Acceptable for this monorepo’s tooling use. |
| `@libav.js/types` / `@libav.js/variant-opus-af` | LGPL-2.1-only | Transitive via `@moq/hang` / libav.js WebCodecs polyfill for MoQ watch. LGPL media library; loaded as a library, not statically forked into proprietary code. |

## When to revisit

- Replace `@dr.pogodin/react-native-static-server` if a pure-MIT loopback HLS server works on iOS TVOS.
- Drop or isolate `sharp` platform optionalDeps if a future Wrangler release no longer needs them for local tooling.
- Re-check `node-forge` when upstream publishes a release newer than `1.4.0` (see Dependabot / GHSA-86w9-cpqp-85rv; no patched npm release at time of writing).
