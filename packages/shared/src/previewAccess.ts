/**
 * Catalog / card PRO badge: whether non-subscribers only get a truncated (or empty) preview.
 *
 * Admin semantics (see admin preview lock copy):
 * - Explicit `0` → premium-only (no free preview seconds).
 * - Positive preview shorter than full → locked preview window.
 * - Preview at/above full → free full unlock (no PRO badge).
 *
 * Missing lock (`null` / `undefined` / non-finite) must NOT be treated as premium-only.
 * Do not coerce null → 0 before this check.
 */
export function showsPremiumPreviewHint(
  fullDuration: number | null | undefined,
  previewDuration: number | null | undefined,
): boolean {
  if (previewDuration == null) return false;
  const preview = Number(previewDuration);
  if (!Number.isFinite(preview)) return false;

  const fullRaw = Number(fullDuration);
  const full = Number.isFinite(fullRaw) && fullRaw > 0 ? fullRaw : 0;

  if (full > 0) {
    // Includes explicit 0 → premium-only when a full duration is known.
    return preview < full;
  }
  // Full unknown: only hint when a positive preview window was configured.
  return preview > 0;
}
