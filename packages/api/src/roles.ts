/**
 * Shared role helpers for API authorization/entitlement checks.
 */

import { ROLES } from './auth.js';

// Derive administrative roles from the canonical ROLES list (excluding 'viewer'),
// plus defensive aliases used in some deployments/docs
const ADMINISTRATIVE_ROLES = new Set([
  ...ROLES.filter((r) => r !== 'viewer'),
  'owner',
  'staff',
  'manager',
]);

/** Roles that may edit/publish video content (matches frontend `canEditContent`). */
export const CONTENT_EDITOR_ROLES = ['editor', 'admin', 'super_admin'] as const;

const CONTENT_EDITOR_ROLE_SET = new Set<string>(CONTENT_EDITOR_ROLES);

export function isAdministrativeRole(role: unknown) {
  if (typeof role !== 'string') return false;
  const normalized = role.trim().toLowerCase();
  if (!normalized || normalized === 'viewer') return false;
  return ADMINISTRATIVE_ROLES.has(normalized);
}

/** True for editor / admin / super_admin (draft preview, video CRUD). */
export function isContentEditorRole(role: unknown) {
  if (typeof role !== 'string') return false;
  const normalized = role.trim().toLowerCase();
  return CONTENT_EDITOR_ROLE_SET.has(normalized);
}

/** Staff draft/archive verification preview (editor+ only). */
export function canStaffPreviewUnpublishedVideo(role: unknown) {
  return isContentEditorRole(role);
}

/**
 * Whether unpublished (or not-yet-live) video metadata/playback may be returned.
 * `isPubliclyLive` is computed by the caller (publish_status + schedule).
 */
export function mayAccessNonPublicVideo(role: unknown, isPubliclyLive: boolean) {
  if (isPubliclyLive) return true;
  return canStaffPreviewUnpublishedVideo(role);
}
