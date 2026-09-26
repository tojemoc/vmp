import type { MagicLinkClient } from '@vmp/shared';
import { normalizeMagicLinkClient } from '@vmp/shared';
import { isInstalledPwa } from '~/utils/pwa';

/**
 * Resolve which app surface started sign-in.
 * Same stamp the magic-link email URL already carries (`client=browser|pwa|native`)
 * so OTP / inline auth / `/login` / header popup share one provenance path —
 * the verify page and analytics do not guess from User-Agent.
 */
export function resolveMagicLinkClient(
  override?: MagicLinkClient | string | null,
): MagicLinkClient {
  if (override != null && override !== '') {
    return normalizeMagicLinkClient(override);
  }
  if (import.meta.client && isInstalledPwa()) return 'pwa';
  return 'browser';
}
