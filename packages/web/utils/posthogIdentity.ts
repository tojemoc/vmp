import type { AuthUser } from '~/composables/useAuth';
import type { PostHogIdentityClient } from '~/utils/posthogBrowserClient';
import { isBrowserPostHogReady } from '~/utils/posthogBrowserClient';

export type PostHogIdentitySyncState = {
  supportUserId: string | null;
  supportHash: string | null;
  analyticsUserId: string | null;
};

/**
 * Sync PostHog Support identity (HMAC) and analytics identify().
 *
 * Support identity is set for any logged-in user with a server-signed hash — not
 * gated on product-analytics consent. Analytics identify() still requires consent.
 */
export function syncPostHogIdentity(
  posthogClient: PostHogIdentityClient,
  authUser: AuthUser | null | undefined,
  hasAnalyticsConsent: boolean,
  state: PostHogIdentitySyncState,
): void {
  if (!isBrowserPostHogReady(posthogClient)) return;

  if (!authUser) {
    if (state.analyticsUserId !== null) {
      posthogClient.reset?.();
      state.analyticsUserId = null;
    }
    if (state.supportUserId !== null) {
      posthogClient.clearIdentity?.();
      state.supportUserId = null;
      state.supportHash = null;
    }
    return;
  }

  const supportHash = authUser.posthogIdentityHash?.trim();
  if (supportHash) {
    if (state.supportUserId !== authUser.id || state.supportHash !== supportHash) {
      posthogClient.setIdentity?.(authUser.id, supportHash);
      state.supportUserId = authUser.id;
      state.supportHash = supportHash;
    }
  } else if (state.supportUserId !== null || state.supportHash !== null) {
    posthogClient.clearIdentity?.();
    state.supportUserId = null;
    state.supportHash = null;
  }

  if (!hasAnalyticsConsent) {
    if (state.analyticsUserId !== null) {
      posthogClient.reset?.();
      state.analyticsUserId = null;
      if (supportHash && state.supportUserId === authUser.id) {
        posthogClient.setIdentity?.(authUser.id, supportHash);
        state.supportHash = supportHash;
      }
    }
    return;
  }

  if (state.analyticsUserId === authUser.id) return;

  if (state.analyticsUserId !== null) {
    posthogClient.reset?.();
    if (supportHash) {
      posthogClient.setIdentity?.(authUser.id, supportHash);
      state.supportUserId = authUser.id;
      state.supportHash = supportHash;
    }
  }

  posthogClient.identify?.(authUser.id, {
    role: authUser.role,
  });
  state.analyticsUserId = authUser.id;
}
