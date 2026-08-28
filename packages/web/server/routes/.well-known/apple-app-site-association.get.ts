import { buildAppleAppSiteAssociation, parseAppleAppIds } from '../../../utils/appLinksAssociation';

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const association = buildAppleAppSiteAssociation(parseAppleAppIds(config.appLinks?.appleAppIds));

  // No Apple app id configured for this deployment — nothing to assert.
  if (!association) {
    if (String(config.appLinks?.appleAppIds || '').trim()) {
      // Set but unusable: say so, or checklist S5 fails with only a silent 404.
      console.warn(
        '[app-links] MOBILE_APPLE_APP_IDS is set but no entry looks like <AppleTeamId>.<bundleId>.',
      );
    }
    throw createError({ statusCode: 404, statusMessage: 'Not configured' });
  }

  // Apple requires application/json and no redirect on this path.
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8');
  setResponseHeader(event, 'cache-control', 'public, max-age=3600');
  return association;
});
