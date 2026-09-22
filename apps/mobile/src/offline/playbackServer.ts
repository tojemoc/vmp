import Server from '@dr.pogodin/react-native-static-server';
import { Platform } from 'react-native';
import { buildOfflinePlaybackHttpUrl, fileUriToFsPath } from './playbackUrls';
import { ensureOfflineRoot, offlineRootUri } from './storage';

export { buildOfflinePlaybackHttpUrl, fileUriToFsPath } from './playbackUrls';

/**
 * iOS AVPlayer (and thus expo-video) cannot play HLS from file:// URLs.
 * Serve the offline download tree over loopback HTTP so the player sees a normal
 * http://…/offline-master.m3u8 playlist (same approach as a local reverse-proxy).
 */

let server: InstanceType<typeof Server> | null = null;
let originPromise: Promise<string> | null = null;

export async function ensureOfflinePlaybackServer(): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('Offline HLS local server is not available on web');
  }
  if (originPromise) return originPromise;

  originPromise = (async () => {
    await ensureOfflineRoot();
    const fileDir = fileUriToFsPath(offlineRootUri());
    if (server) {
      try {
        await server.stop();
      } catch {
        // Recreate below.
      }
      server = null;
    }
    server = new Server({
      fileDir,
      hostname: '127.0.0.1',
      // Ephemeral port — avoid clashing with Metro / wrangler on simulators.
      port: 0,
      stopInBackground: false,
    });
    const origin = await server.start();
    if (!origin) {
      throw new Error('Offline playback server failed to start');
    }
    return origin.replace(/\/+$/, '');
  })().catch((err) => {
    originPromise = null;
    server = null;
    throw err;
  });

  return originPromise;
}

export async function stopOfflinePlaybackServer(): Promise<void> {
  const current = server;
  server = null;
  originPromise = null;
  if (!current) return;
  try {
    await current.stop();
  } catch {
    // Best-effort shutdown.
  }
}

/** Convenience: origin + video path for expo-video. */
export async function offlineMasterPlaylistHttpUrl(videoId: string): Promise<string> {
  const origin = await ensureOfflinePlaybackServer();
  return buildOfflinePlaybackHttpUrl(origin, videoId);
}
