/**
 * Digital Asset Links (Android) and Apple App Site Association documents for
 * the native clients' magic-link deep link.
 *
 * `apps/mobile/app.json` declares the `/auth/verify` intent filter with
 * `autoVerify: true`, which only succeeds if the frontend host serves
 * `/.well-known/assetlinks.json`. Without it Android silently falls back to
 * opening the browser, and Google's verifier keeps re-fetching the missing file.
 *
 * The signing-certificate fingerprint and Apple team id are build/signing
 * secrets, so both documents are assembled from deploy env rather than
 * committed. Unconfigured deployments serve nothing (404) — see
 * `docs/native-clients-promotion-checklist.md` item S5.
 */

/** Must stay in step with the Android `pathPrefix` in `apps/mobile/app.json`. */
export const APP_LINK_PATH_PREFIX = '/auth/verify';

/** Uppercase colon-separated SHA-256, exactly as `keytool`/Play Console print it. */
const SHA256_FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** `<10-char Apple team id>.<bundle identifier>`, e.g. `ABCDE12345.sk.tjm.vmp`. */
const APPLE_APP_ID = /^[0-9A-Z]{10}\.[A-Za-z0-9.-]+$/;

function splitList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Malformed entries are dropped rather than served: Google rejects the whole
 * file on a bad fingerprint, so a typo would silently break verification for
 * the valid entries too.
 */
export function parseAndroidCertFingerprints(raw: unknown): string[] {
  return [...new Set(splitList(raw).map((entry) => entry.toUpperCase()))].filter((entry) =>
    SHA256_FINGERPRINT.test(entry),
  );
}

export function parseAppleAppIds(raw: unknown): string[] {
  return [...new Set(splitList(raw))].filter((entry) => APPLE_APP_ID.test(entry));
}

export type AssetLinksStatement = {
  relation: string[];
  target: {
    namespace: 'android_app';
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
};

export function buildAssetLinks(
  packageName: string,
  fingerprints: string[],
): AssetLinksStatement[] | null {
  const trimmedPackage = packageName.trim();
  if (!trimmedPackage || fingerprints.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: trimmedPackage,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

export type AppleAppSiteAssociation = {
  applinks: {
    details: Array<{
      appIDs: string[];
      components: Array<{ '/': string; comment: string }>;
    }>;
  };
};

export function buildAppleAppSiteAssociation(appIds: string[]): AppleAppSiteAssociation | null {
  if (appIds.length === 0) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: appIds,
          components: [{ '/': `${APP_LINK_PATH_PREFIX}*`, comment: 'Magic-link sign-in' }],
        },
      ],
    },
  };
}
