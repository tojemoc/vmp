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
| AltStore source JSON | `docs/altstore-source.json` → GitHub Pages |
| Install page | `docs/index.html` → GitHub Pages |
| OTA manifest (optional) | `docs/manifest.plist` → GitHub Pages |

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
4. Optionally override `build_number` (defaults to `expo.ios.buildNumber` in `apps/mobile/app.json`).
5. Download the Android APK from workflow artifacts if needed.
6. On iPhone: add the Pages source URL in SideStore and install the desired version.

## Repo setup (maintainer, one-time)

1. **GitHub Pages:** Settings → Pages → Build from branch → `/docs` on `main`.
2. Ensure workflow permissions allow `contents: write` (for releases + `[skip ci]` commits to `docs/`).
3. First merge to `main` after this workflow lands; run **Mobile artifacts** once to populate Releases + Pages.

## Updating permissions metadata

When native entitlements or Info.plist privacy keys change (after `expo prebuild`), update `docs/altstore-source.meta.json`:

- `appPermissions.entitlements` — iOS entitlements (e.g. associated domains).
- `appPermissions.privacy` — `NS*UsageDescription` keys from Info.plist.

Regenerate `docs/altstore-source.json` on the next CI run or locally:

```bash
GITHUB_REPOSITORY=tojemoc/vmp python3 scripts/generate-altstore-source.py
```
