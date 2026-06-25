import type { OfflineLicense } from '@vmp/shared'

export function isLicensePlaybackAllowed(license: OfflineLicense | null | undefined): boolean {
  if (!license) return false
  if (license.playbackState !== 'allowed') return false
  const expiresAt = Date.parse(license.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false
  return true
}

export function isLicenseRevalidationDue(license: OfflineLicense): boolean {
  const dueAt = Date.parse(license.nextValidationDueAt)
  if (!Number.isFinite(dueAt)) return true
  return dueAt <= Date.now()
}

export function licenseExpiryLabel(license: OfflineLicense): string {
  return new Date(license.expiresAt).toLocaleString()
}
