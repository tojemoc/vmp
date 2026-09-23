#!/usr/bin/env python3
"""Assemble the SideStore / GitHub Pages install site (no git push).

Writes into ``--site-dir`` (default ``site/``):
  - index.html (from docs/index.html.template)
  - manifest.plist (from docs/manifest.plist.template)
  - downloads.json (nightly.link run-scoped pointers)
  - .nojekyll
  - altstore-source.json (copied when present)

Used by:
  - ``.github/workflows/mobile-artifacts.yml`` after each publish
  - ``.github/workflows/publish-sidestore-pages.yml`` for manual republish
    (restores the install site after a mistaken ``pages-build-deployment`` re-run)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TAG_RE = re.compile(
    r"^(?P<flavor>.+)-v(?P<version>[\d.]+)-build(?P<build>\d+)$",
    re.IGNORECASE,
)
COMMIT_RE = re.compile(r"- Commit: `([0-9a-fA-F]{40})`")


def api_get(url: str, token: str | None) -> object:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "vmp-build-sidestore-pages-site",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode())


def api_get_paginated(url: str, token: str | None, *, list_key: str | None = None) -> list:
    """Fetch all pages. When list_key is set, items are under that key (e.g. artifacts)."""
    items: list = []
    next_url: str | None = url
    while next_url:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "vmp-build-sidestore-pages-site",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(next_url, headers=headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode())
            link = response.headers.get("Link") or ""
        if list_key:
            chunk = payload.get(list_key) or []
            if not isinstance(chunk, list):
                raise SystemExit(f"Expected list at '{list_key}' from {next_url}")
            items.extend(chunk)
        elif isinstance(payload, list):
            items.extend(payload)
        else:
            raise SystemExit(f"Unexpected non-list payload from {next_url}")
        next_url = None
        for part in link.split(","):
            if 'rel="next"' in part:
                next_url = part[part.find("<") + 1 : part.find(">")]
                break
    return items


def run_has_successful_publish_job(repo: str, run_id: int, token: str | None) -> bool:
    """True when this run's publish-ios-release job concluded successfully.

    Overall workflow success is not enough: artifact-only dispatches
    (publish_release=false) still upload ios-ipa but skip Pages publish.
    """
    jobs_url = f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/jobs"
    jobs = api_get_paginated(jobs_url, token, list_key="jobs")
    for job in jobs:
        if job.get("name") == "publish-ios-release" and job.get("conclusion") == "success":
            return True
    return False


def resolve_mobile_artifacts_run_id(repo: str, token: str | None, explicit: str | None) -> int:
    if explicit:
        return int(explicit)

    workflow_path = ".github/workflows/mobile-artifacts.yml"
    # Prefer successful main runs that actually published Pages (not artifact-only).
    url = (
        f"https://api.github.com/repos/{repo}/actions/workflows/"
        f"{urllib.parse.quote(workflow_path, safe='')}/runs"
        f"?branch=main&status=success&per_page=30"
    )
    runs = api_get_paginated(url, token, list_key="workflow_runs")
    for run in runs:
        run_id = run.get("id")
        if not run_id:
            continue
        if not run_has_successful_publish_job(repo, int(run_id), token):
            continue
        artifacts_url = f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/artifacts"
        artifacts = api_get_paginated(artifacts_url, token, list_key="artifacts")
        names = {a.get("name") for a in artifacts if not a.get("expired")}
        if "ios-ipa" in names:
            print(
                f"Resolved latest Mobile artifacts run with successful publish-ios-release "
                f"and ios-ipa: {run_id}",
                file=sys.stderr,
            )
            return int(run_id)
    raise SystemExit(
        "Could not find a successful Mobile artifacts run on main whose publish-ios-release "
        "job succeeded and that still has a non-expired ios-ipa artifact. "
        "Pass --run-id explicitly."
    )


def fetch_run_artifacts(repo: str, run_id: int, token: str | None) -> dict[str, int]:
    url = f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/artifacts"
    artifacts = api_get_paginated(url, token, list_key="artifacts")
    out: dict[str, int] = {}
    for artifact in artifacts:
        if artifact.get("expired"):
            continue
        name = artifact.get("name")
        artifact_id = artifact.get("id")
        if isinstance(name, str) and isinstance(artifact_id, int):
            out[name] = artifact_id
    return out


def fetch_run(repo: str, run_id: int, token: str | None) -> dict:
    data = api_get(f"https://api.github.com/repos/{repo}/actions/runs/{run_id}", token)
    if not isinstance(data, dict):
        raise SystemExit(f"Unexpected run payload for {run_id}")
    return data


def find_release_for_commit(repo: str, commit_sha: str, token: str | None) -> dict | None:
    url = f"https://api.github.com/repos/{repo}/releases?per_page=40"
    releases = api_get_paginated(url, token)
    for release in releases:
        if not isinstance(release, dict):
            continue
        body = release.get("body") or ""
        match = COMMIT_RE.search(body)
        if match and match.group(1).lower() == commit_sha.lower():
            return release
        # softprops may set target_commitish to a branch name; prefer body.
        target = release.get("target_commitish") or ""
        if isinstance(target, str) and len(target) == 40 and target.lower() == commit_sha.lower():
            return release
    return None


def parse_release_identity(tag: str) -> tuple[str, str, str]:
    match = TAG_RE.match(tag)
    if not match:
        raise SystemExit(
            f"Release tag '{tag}' does not match <flavor>-v<version>-build<build>. "
            "Pass --flavor/--version/--build explicitly."
        )
    return match.group("flavor"), match.group("version"), match.group("build")


def render_site(
    *,
    repo: str,
    owner: str,
    repo_name: str,
    flavor: str,
    version: str,
    build: str,
    run_id: int,
    ios_artifact_id: int,
    android_artifact_id: int | None,
    docs_dir: Path,
    site_dir: Path,
    altstore_source: Path | None,
) -> None:
    tag = f"{flavor}-v{version}-build{build}"
    ipa_file = f"vmp-{version}-ios.ipa"
    ipa_url = f"https://github.com/{repo}/releases/download/{tag}/{ipa_file}"
    pages_url = f"https://{owner}.github.io/{repo_name}"
    manifest_url = f"{pages_url}/manifest.plist"
    install_url = "itms-services://?action=download-manifest&url=" + urllib.parse.quote(
        manifest_url, safe=""
    )
    install_url_html = install_url.replace("&", "&amp;")
    run_url = f"https://github.com/{repo}/actions/runs/{run_id}"
    ios_nightly = f"https://nightly.link/{repo}/actions/runs/{run_id}/ios-ipa.zip"
    android_nightly = (
        f"https://nightly.link/{repo}/actions/runs/{run_id}/mobile-android-apk.zip"
        if android_artifact_id
        else ""
    )
    android_btn = (
        f'<a class="secondary-btn" href="{android_nightly}">Download Android APK (zip)</a>'
        if android_nightly
        else ""
    )
    altstore_source_url = f"{pages_url}/altstore-source.json"

    site_dir.mkdir(parents=True, exist_ok=True)

    manifest_text = (docs_dir / "manifest.plist.template").read_text()
    manifest_text = manifest_text.replace("__IPA_URL__", ipa_url).replace(
        "__BUILD_NUMBER__", build
    )
    (site_dir / "manifest.plist").write_text(manifest_text)

    index_text = (docs_dir / "index.html.template").read_text()
    replacements = {
        "__VERSION__": version,
        "__FLAVOR_LABEL__": flavor,
        "__INSTALL_URL__": install_url_html,
        "__ALTSTORE_SOURCE_URL__": altstore_source_url,
        "__IOS_NIGHTLY_LINK__": ios_nightly,
        "__ANDROID_NIGHTLY_BTN__": android_btn,
        "__RUN_URL__": run_url,
        "__RUN_ID__": str(run_id),
    }
    for key, value in replacements.items():
        index_text = index_text.replace(key, value)
    (site_dir / "index.html").write_text(index_text)

    updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload: dict = {
        "updatedAt": updated_at,
        "flavor": flavor,
        "version": version,
        "build": build,
        "releaseTag": tag,
        "runId": run_id,
        "runUrl": run_url,
        "pagesUrl": f"{pages_url}/",
        "altstoreSourceUrl": altstore_source_url,
        "note": (
            "nightly.link /workflows/{name}/{branch} only finds push/schedule runs; "
            "these run-scoped URLs work for workflow_dispatch and need no GitHub login. "
            "Do not re-run GitHub's dynamic pages-build-deployment workflow — it deploys "
            "raw /docs (markdown/templates) and wipes this install site. Use Actions → "
            "Publish SideStore Pages instead."
        ),
        "ios": {
            "artifactName": "ios-ipa",
            "artifactId": ios_artifact_id,
            "nightlyLink": ios_nightly,
            "releaseAssetUrl": ipa_url,
        },
        "android": None,
    }
    if android_artifact_id and android_nightly:
        payload["android"] = {
            "artifactName": "mobile-android-apk",
            "artifactId": android_artifact_id,
            "nightlyLink": android_nightly,
        }
    (site_dir / "downloads.json").write_text(json.dumps(payload, indent=2) + "\n")

    nojekyll_src = docs_dir / ".nojekyll"
    if nojekyll_src.exists():
        shutil.copy2(nojekyll_src, site_dir / ".nojekyll")
    else:
        (site_dir / ".nojekyll").write_text("")

    if altstore_source and altstore_source.is_file():
        shutil.copy2(altstore_source, site_dir / "altstore-source.json")
    else:
        print(
            "Warning: altstore-source.json missing; site will deploy without it.",
            file=sys.stderr,
        )

    print(f"Built SideStore Pages site in {site_dir}/ for {tag} (run {run_id})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--owner", default=os.environ.get("GITHUB_REPOSITORY_OWNER", ""))
    parser.add_argument(
        "--repo-name",
        default=os.environ.get("GITHUB_REPOSITORY_NAME")
        or os.environ.get("GITHUB_EVENT_REPOSITORY_NAME", ""),
    )
    parser.add_argument("--run-id", default=os.environ.get("MOBILE_ARTIFACTS_RUN_ID", ""))
    parser.add_argument("--flavor", default=os.environ.get("FLAVOR_LABEL", ""))
    parser.add_argument("--version", default=os.environ.get("VERSION_NAME", ""))
    parser.add_argument("--build", default=os.environ.get("BUILD_NUMBER", ""))
    parser.add_argument(
        "--android-job-result",
        default=os.environ.get("ANDROID_JOB_RESULT", ""),
        help="When set to success, require mobile-android-apk on the run. "
        "Empty means include Android if the artifact exists.",
    )
    parser.add_argument("--docs-dir", type=Path, default=Path("docs"))
    parser.add_argument("--site-dir", type=Path, default=Path("site"))
    parser.add_argument(
        "--altstore-source",
        type=Path,
        default=Path("docs/altstore-source.json"),
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"),
    )
    args = parser.parse_args()

    if not args.repo or "/" not in args.repo:
        raise SystemExit("Pass --repo owner/name or set GITHUB_REPOSITORY")
    owner = args.owner or args.repo.split("/", 1)[0]
    repo_name = args.repo_name or args.repo.split("/", 1)[1]

    run_id = resolve_mobile_artifacts_run_id(
        args.repo, args.token, args.run_id.strip() or None
    )
    run = fetch_run(args.repo, run_id, args.token)
    head_sha = run.get("head_sha") or ""
    artifacts = fetch_run_artifacts(args.repo, run_id, args.token)
    if "ios-ipa" not in artifacts:
        raise SystemExit(f"Run {run_id} has no non-expired ios-ipa artifact")

    flavor = args.flavor.strip()
    version = args.version.strip()
    build = args.build.strip()
    if not (flavor and version and build):
        release = find_release_for_commit(args.repo, str(head_sha), args.token)
        if not release:
            raise SystemExit(
                f"No GitHub Release body matching commit {head_sha} for run {run_id}. "
                "Pass --flavor/--version/--build, or publish a release first."
            )
        tag = release.get("tag_name") or ""
        flavor, version, build = parse_release_identity(str(tag))
        print(f"Resolved release {tag} from commit {head_sha[:7]}", file=sys.stderr)

    android_id: int | None = artifacts.get("mobile-android-apk")
    android_result = args.android_job_result.strip()
    if android_result == "success":
        if not android_id:
            raise SystemExit(
                f"Android job succeeded but mobile-android-apk is missing on run {run_id}"
            )
    elif android_result in ("failure", "cancelled", "skipped"):
        if android_result in ("failure", "cancelled"):
            print(
                f"Android build {android_result}; omitting APK nightly.link button.",
                file=sys.stderr,
            )
        android_id = None
    # else: include Android when the artifact exists (republish path)

    render_site(
        repo=args.repo,
        owner=owner,
        repo_name=repo_name,
        flavor=flavor,
        version=version,
        build=build,
        run_id=run_id,
        ios_artifact_id=artifacts["ios-ipa"],
        android_artifact_id=android_id,
        docs_dir=args.docs_dir,
        site_dir=args.site_dir,
        altstore_source=args.altstore_source if args.altstore_source.exists() else None,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"GitHub API HTTP {exc.code}: {body}", file=sys.stderr)
        raise SystemExit(1) from exc
