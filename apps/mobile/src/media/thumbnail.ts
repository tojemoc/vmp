/**
 * Thumbnail size helpers — same R2 layout as packages/web/composables/useThumbnail.ts.
 *
 *   thumbnails/{videoId}/large.jpg   — 1280×720
 *   thumbnails/{videoId}/medium.jpg  —  640×360
 *   thumbnails/{videoId}/small.jpg   —  320×180
 */

export type ThumbnailSize = 'large' | 'medium' | 'small';

const SIZE_RE = /(\/)(large|medium|small)(\.jpg)(\?.*)?$/i;

/** Swap the size token in a thumbnail URL; returns undefined when empty. */
export function sizeUrl(url: string | null | undefined, size: ThumbnailSize): string | undefined {
  if (!url) return undefined;
  return url.replace(
    SIZE_RE,
    (_match, slash: string, _currentSize: string, ext: string, query: string | undefined) =>
      `${slash}${size}${ext}${query ?? ''}`,
  );
}

/** Prefer small, fall back to medium / original for catalog cards. */
export function catalogThumbnailUrl(url: string | null | undefined): string | undefined {
  return sizeUrl(url, 'small') ?? sizeUrl(url, 'medium') ?? (url || undefined);
}
