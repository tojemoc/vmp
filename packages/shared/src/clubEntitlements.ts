/**
 * Club plan entitlement helpers (concurrent playback is enforced server-side;
 * IRL access + ad-free gating share these plan/role checks).
 */

const STAFF_ROLES = new Set([
  'super_admin',
  'admin',
  'editor',
  'analyst',
  'moderator',
  'owner',
  'staff',
  'manager',
]);

export function isClubPlanType(planType: unknown): boolean {
  return typeof planType === 'string' && planType.trim().toLowerCase() === 'club';
}

export function isStaffRole(role: unknown): boolean {
  if (typeof role !== 'string') return false;
  const normalized = role.trim().toLowerCase();
  return Boolean(normalized) && STAFF_ROLES.has(normalized);
}

/** Club subscribers and staff skip ads when ads are globally enabled. */
export function hasAdFreeEntitlement(opts: {
  planType?: string | null;
  role?: string | null;
}): boolean {
  return isStaffRole(opts.role) || isClubPlanType(opts.planType);
}

/**
 * When ads are globally off, nobody sees ads.
 * When on, club + staff skip insertion; other plans see ads.
 */
export function shouldShowAds(opts: {
  adsEnabled: boolean;
  planType?: string | null;
  role?: string | null;
}): boolean {
  if (!opts.adsEnabled) return false;
  return !hasAdFreeEntitlement(opts);
}

/** Club-only IRL events require club plan or staff; open events allow any signed-in user. */
export function canAccessIrlEvent(opts: {
  clubOnly: boolean;
  planType?: string | null;
  role?: string | null;
}): boolean {
  if (!opts.clubOnly) return true;
  return isStaffRole(opts.role) || isClubPlanType(opts.planType);
}
