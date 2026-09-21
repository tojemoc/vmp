#!/usr/bin/env node
/**
 * SideStore update detection compares SemanticVersion of CFBundleShortVersionString
 * (`version` in the AltStore source). It does **not** treat a buildVersion-only bump
 * as an update when major.minor.patch are equal (see SideStore InstalledApp.hasUpdate;
 * the AltStore predicate that also compared buildVersion is commented out upstream).
 *
 * Encode the CI build into the patch component so each published IPA has a strictly
 * increasing marketing version: base `0.1.0` + build `10` → `0.1.10`.
 *
 * Usage: node scripts/ios-sidestore-marketing-version.mjs <baseVersion> <buildNumber>
 */

import { pathToFileURL } from "node:url";

/**
 * @param {string} baseVersion expo.version from app.json (e.g. "0.1.0")
 * @param {string|number} buildNumber CI build / CFBundleVersion
 * @returns {string} CFBundleShortVersionString for SideStore-compatible updates
 */
export function sidestoreMarketingVersion(baseVersion, buildNumber) {
  const build = String(buildNumber).trim();
  if (!/^\d+$/.test(build)) {
    throw new Error(`build number must be a positive integer, got: ${buildNumber}`);
  }

  const raw = String(baseVersion ?? "").trim();
  if (!raw) {
    throw new Error("base version is required");
  }

  const parts = raw.split(".");
  const major = parts[0] || "0";
  const minor = parts[1] || "0";
  if (!/^\d+$/.test(major) || !/^\d+$/.test(minor)) {
    throw new Error(`base version must start with numeric major.minor, got: ${baseVersion}`);
  }

  return `${major}.${minor}.${build}`;
}

/**
 * Minimal SideStore-like check: update if latest major.minor.patch > installed.
 * Mirrors the SemanticVersion major/minor/patch compare in InstalledApp.hasUpdate.
 */
export function sidestoreWouldOfferUpdate(installedMarketing, latestMarketing) {
  const parse = (v) => {
    const [maj, min, pat] = String(v).split(".").map((p) => Number.parseInt(p, 10) || 0);
    return [maj, min, pat];
  };
  const a = parse(installedMarketing);
  const b = parse(latestMarketing);
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true;
    if (b[i] < a[i]) return false;
  }
  return false;
}

function main(argv) {
  const [, , base, build] = argv;
  if (base === undefined || build === undefined) {
    console.error(
      "Usage: node scripts/ios-sidestore-marketing-version.mjs <baseVersion> <buildNumber>",
    );
    process.exit(1);
  }
  process.stdout.write(`${sidestoreMarketingVersion(base, build)}\n`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry && import.meta.url === entry) {
  try {
    main(process.argv);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
