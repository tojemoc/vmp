import { buildAssetLinks, parseAndroidCertFingerprints } from '../../../utils/appLinksAssociation';

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const statements = buildAssetLinks(
    String(config.appLinks?.androidPackageName || ''),
    parseAndroidCertFingerprints(config.appLinks?.androidCertFingerprints),
  );

  // No signing fingerprint configured for this deployment — nothing to assert.
  if (!statements) {
    if (String(config.appLinks?.androidCertFingerprints || '').trim()) {
      // Set but unusable: say so, or checklist S5 fails with only a silent 404.
      console.warn(
        '[app-links] MOBILE_ANDROID_SHA256_CERT_FINGERPRINTS is set but no entry is a valid upper-case colon-separated SHA-256.',
      );
    }
    throw createError({ statusCode: 404, statusMessage: 'Not configured' });
  }

  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8');
  setResponseHeader(event, 'cache-control', 'public, max-age=3600');
  return statements;
});
