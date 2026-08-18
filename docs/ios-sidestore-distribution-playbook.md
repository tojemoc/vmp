# iOS SideStore distribution playbook

This repo ships **manual** iOS test builds for SideStore/AltStore, mirroring [tojemoc/floaty](https://github.com/tojemoc/floaty).

## Source URL (GitHub Pages)

After the first successful **Mobile artifacts** workflow run on `main`, testers add this AltStore source in SideStore:

`https://tojemoc.github.io/vmp/altstore-source.json`

SideStore deep link (open on iPhone with SideStore installed):

`sidestore://source?url=https%3A%2F%2Ftojemoc.github.io%2Fvmp%2Faltstore-source.json`

Install page (OTA manifest + source link):

`https://tojemoc.github.io/vmp/`

**No Mac is required** for SideStore installs — SideStore re-signs IPAs downloaded from GitHub Releases.

## What CI publishes

| Artifact | Location |
| --- | --- |
| IPA file | GitHub Release asset (`vmp-<version>-ios.ipa`) |
| AltStore source JSON | `gh-pages` branch (`altstore-source.json`) |
| Install page | `gh-pages` branch (`index.html`) |
| OTA manifest (optional) | `gh-pages` branch (`manifest.plist`) |

IPAs are **not** hosted on GitHub Pages. `downloadURL` in the source JSON always points at **GitHub Release assets**.

## Release tag format

`<flavor>-v<semver>-build<build>`

Examples:

- `release-v0.1.0-build42`
- `nightly-v0.1.0-build43`
- `development-v0.1.1-build1`

## IPA packaging rules (SideStore)

Script: `scripts/package-ios-ipa-for-sidestore.sh`

1. Copy `.app` into `Payload/App.app/` (never `../../Payload/`).
2. Strip existing `_CodeSignature` directories.
3. Ad-hoc sign every `Frameworks/*` bundle, then the app bundle (`codesign -s -`).
4. Zip from inside the temp dir so paths start with `Payload/`.

## AltStore source generator

Script: `scripts/generate-altstore-source.py`

- Reads all GitHub Releases (including pre-releases).
- Matches IPA assets named `vmp-<version>-ios.ipa`.
- Parses flavor from release tag suffix `-v<version>-build<build>`.
- Deduplicates by `(version, buildVersion)` only — prefers `release` > `beta` > `nightly` > `development` > feature-branch tags, then newest `published_at`.
- Verifies the output JSON has **no duplicate** `(version, buildVersion)` pairs.

Static metadata lives in `docs/altstore-source.meta.json` (name, icon, website, tint, permissions).

## Running a build manually

1. GitHub → **Actions** → **Mobile artifacts** → **Run workflow**.
2. Set `api_url` and `frontend_host` for the target environment.
3. Choose `flavor` (`release`, `beta`, `nightly`, `development`).
4. Optionally override `build_number` (defaults to the GitHub Actions **run number**, not `app.json`). Must be unique per flavor+version or the job fails instead of replacing an existing IPA.
5. Canonical `flavor: release` is only allowed when dispatching from `main`. Feature branches may publish `beta` / `nightly` / `development` pre-releases.
6. Download the Android APK from workflow artifacts if needed.
7. On iPhone: add the Pages source URL in SideStore and install the desired version.

## Repo setup (maintainer, one-time)

1. **GitHub Pages:** Settings → Pages → Deploy from a branch → `gh-pages` / `/` (root). Do **not** publish Pages from `main` (`main` pushes autodeploy staging).
2. The publish job has `contents: write` so it can create GitHub Releases and push **only** to `gh-pages` (`git push origin HEAD:gh-pages`). It never pushes to `main`.
3. First merge to `main` after this workflow lands; run **Mobile artifacts** from `main` once to populate Releases + Pages.

## Updating permissions metadata

When native entitlements or Info.plist privacy keys change (after `expo prebuild`), update `docs/altstore-source.meta.json`:

- `appPermissions.entitlements` — iOS entitlements (e.g. associated domains).
- `appPermissions.privacy` — `NS*UsageDescription` keys from Info.plist.

Regenerate `docs/altstore-source.json` on the next CI run or locally:

```bash
GITHUB_REPOSITORY=tojemoc/vmp python3 scripts/generate-altstore-source.py
```
