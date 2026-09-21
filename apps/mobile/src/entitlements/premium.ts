/**
 * Premium entitlement helpers — mirror packages/web/composables/useAuth.ts isPremium.
 */

export type AccountSubscription = {
  status: string;
  currentPeriodEnd?: string | null;
  planType?: string | null;
} | null;

/** Non-viewer roles (editor/admin/…) get premium on web; keep the same rule here. */
export function isElevatedViewerRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const normalized = role.trim().toLowerCase();
  return normalized !== '' && normalized !== 'viewer';
}

export function isActiveSubscription(
  subscription: AccountSubscription,
  now: Date = new Date(),
): boolean {
  if (!subscription) return false;
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false;
  if (!subscription.currentPeriodEnd) return true;
  const end = new Date(subscription.currentPeriodEnd);
  if (Number.isNaN(end.getTime())) return false;
  return end > now;
}

export function isPremiumUser(opts: {
  role?: string | null;
  subscription: AccountSubscription;
  now?: Date;
}): boolean {
  if (isElevatedViewerRole(opts.role)) return true;
  return isActiveSubscription(opts.subscription, opts.now);
}
