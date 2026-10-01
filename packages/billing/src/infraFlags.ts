/**
 * Tier-1 infrastructure feature flags via Cloudflare Flagship.
 * Implementation lives in `@vmp/shared` so API can share the same helpers.
 *
 * @see docs/plans/flagship-and-payment-middleware.md
 */
export {
  buildInfraFeatureManifest,
  createStaticFlagshipBinding,
  isInfraFeatureEnabled,
  type FlagshipBinding,
  type InfraFlagsEnv,
} from '@vmp/shared';
