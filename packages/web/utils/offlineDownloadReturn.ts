const STORAGE_KEY = 'vmp_reopen_offline_download';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

type OfflineDownloadReturnIntent = {
  videoId: string;
  ts: number;
};

function readIntent(): OfflineDownloadReturnIntent | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineDownloadReturnIntent>;
    if (typeof parsed.videoId !== 'string' || typeof parsed.ts !== 'number') return null;
    return { videoId: parsed.videoId, ts: parsed.ts };
  } catch {
    return null;
  }
}

/** Remember that checkout started from the offline-download upsell. */
export function markOfflineDownloadReturn(videoId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const intent: OfflineDownloadReturnIntent = { videoId, ts: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Ignore quota / private-mode failures; return resume is best-effort.
  }
}

/** Drop a stored download-return intent without consuming it. */
export function clearOfflineDownloadReturn(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** True when this watch page should resume the download menu after checkout. */
export function consumeOfflineDownloadReturn(videoId: string, now = Date.now()): boolean {
  const intent = readIntent();
  clearOfflineDownloadReturn();
  if (!intent) return false;
  if (intent.videoId !== videoId) return false;
  if (now - intent.ts > MAX_AGE_MS) return false;
  return true;
}
