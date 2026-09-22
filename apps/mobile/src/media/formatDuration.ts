import { showsPremiumPreviewHint } from '@vmp/shared';

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

/**
 * PRO badge for catalog/watch — shared null-vs-zero semantics with web.
 * Re-export under the mobile name used by screens/tests.
 */
export const showsPremiumHint = showsPremiumPreviewHint;
