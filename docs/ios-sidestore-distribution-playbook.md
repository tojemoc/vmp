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
| AltStore source JSON | GitHub Pages deployment (`altstore-source.json`, generated from `altstore-source.meta.json`) |
| Install page | GitHub Pages deployment (`index.html`, from template) |
| OTA manifest (optional) | GitHub Pages deployment (`manifest.plist`, from template) |

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
5. **Publishing** (`publish_release`) is only allowed when dispatching from `main` (all flavors). From a feature branch, disable `publish_release` to build IPA/APK artifacts without updating GitHub Releases or the public GitHub Pages install site.
6. Download the Android APK from workflow artifacts if needed.
7. On iPhone: add the Pages source URL in SideStore and install the desired version.

## Repo setup (maintainer, one-time)

1. **GitHub Pages:** Settings → Pages → **Build and deployment → Source: GitHub Actions**. Do **not** publish Pages from `main` (`main` pushes autodeploy staging).
2. The publish job uses the official Pages deploy actions (`configure-pages`, `upload-pages-artifact`, `deploy-pages`). It creates GitHub Releases and deploys generated Pages files **without** committing or pushing to `main` or any branch.
3. After merge to `main`, run **Mobile artifacts** from `main` once (with `publish_release` enabled) to populate the first Release and Pages deployment. All publishing (any flavor) requires dispatch from `main`.

## Updating permissions metadata

When native entitlements or Info.plist privacy keys change (after `expo prebuild`), update `docs/altstore-source.meta.json`:

- `appPermissions.entitlements` — iOS entitlements (e.g. associated domains).
- `appPermissions.privacy` — `NS*UsageDescription` keys from Info.plist.

Regenerate the AltStore source locally (writes `docs/altstore-source.json`, which is **not** committed):

```bash
GITHUB_REPOSITORY=tojemoc/vmp python3 scripts/generate-altstore-source.py
```
