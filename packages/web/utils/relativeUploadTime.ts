/**
 * The API returns D1/SQLite timestamps (`2026-05-08 16:56:41`) in UTC without a zone
 * designator. `new Date()` would read those as local time, so the server (UTC) and a
 * browser in another zone would disagree on the upload instant.
 */
export function parseApiTimestamp(raw: string | null | undefined): number {
  const value = String(raw ?? '').trim();
  if (!value) return Number.NaN;
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (hasZone || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value)) {
    return new Date(value).getTime();
  }
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

export function formatRelativeUploadTime(
  uploadDate: string | null | undefined,
  now: number,
): string {
  const uploadedAt = parseApiTimestamp(uploadDate);
  if (Number.isNaN(uploadedAt)) return '';
  const diffMs = now - uploadedAt;
  if (diffMs < 0) return '';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}
