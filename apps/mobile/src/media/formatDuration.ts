/** Format seconds as m:ss or h:mm:ss (catalog / watch badges). */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const n = Number(totalSeconds);
  if (!Number.isFinite(n) || n <= 0) return '--';
  const secs = Math.floor(n);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** True when preview is shorter than full (or full unknown with non-zero preview). */
export function showsPremiumHint(
  fullDuration: number | null | undefined,
  previewDuration: number | null | undefined,
): boolean {
  const full = Number(fullDuration) || 0;
  const preview = Number(previewDuration) || 0;
  if (full > 0) return preview < full;
  return preview > 0;
}
