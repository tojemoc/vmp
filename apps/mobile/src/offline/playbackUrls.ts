/** Pure URL helpers for offline loopback HLS (no React Native imports). */

/** `file:///var/.../Documents/vmp-offline/` → absolute filesystem path for Lighttpd. */
export function fileUriToFsPath(uri: string): string {
  const trimmed = uri.trim();
  if (trimmed.startsWith('file://')) {
    // Keep leading slash; decode percent-encoding from expo-file-system URIs.
    return decodeURIComponent(trimmed.slice('file://'.length));
  }
  return trimmed;
}

export function buildOfflinePlaybackHttpUrl(origin: string, videoId: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(videoId)}/offline-master.m3u8`;
}
