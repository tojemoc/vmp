import type { OfflineRendition } from '@vmp/shared';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { getVideoAccess } from '../../src/api/client';
import { useSession } from '../../src/auth/SessionProvider';
import { apiUrl } from '../../src/config';
import {
  getDownloadRecord,
  getOfflinePlaybackUri,
  isDownloadActive,
  pauseOfflineDownload,
  removeOfflineDownload,
  startOfflineDownload,
  subscribeDownloadProgress,
} from '../../src/offline/downloadManager';
import type { DownloadProgress, StoredDownload } from '../../src/offline/types';

const DEFAULT_RENDITION: OfflineRendition = '720p';

export default function WatchScreen() {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const { session } = useSession();
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [source, setSource] = useState<'online' | 'offline' | null>(null);
  const [title, setTitle] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [download, setDownload] = useState<StoredDownload | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

  /** Bumps on sign-out / account switch so in-flight handlers discard stale UI updates. */
  const accountEpochRef = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const accountId = session?.user.id ?? null;
  const prevAccountIdRef = useRef(accountId);
  if (prevAccountIdRef.current !== accountId) {
    prevAccountIdRef.current = accountId;
    accountEpochRef.current += 1;
    if (progress !== null) {
      setProgress(null);
    }
  }

  function isCurrentAccount(epoch: number, userId: string): boolean {
    return accountEpochRef.current === epoch && sessionRef.current?.user.id === userId;
  }

  const id = videoId ? String(videoId) : '';

  const refreshDownload = useCallback(async () => {
    if (!id) return;
    const userId = sessionRef.current?.user.id;
    if (!userId) return;
    const epoch = accountEpochRef.current;
    const record = await getDownloadRecord(id, userId);
    if (accountEpochRef.current !== epoch || sessionRef.current?.user.id !== userId) {
      return;
    }
    setDownload(record);
  }, [id]);

  useEffect(() => {
    if (!id || !accountId) return;
    const userId = accountId;
    return subscribeDownloadProgress(id, (p) => {
      if (p.userId !== userId) return;
      setProgress(p);
      void refreshDownload();
    });
  }, [id, refreshDownload, accountId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session || !id) return;
      setLoading(true);
      setError(null);
      try {
        await refreshDownload();
        const offlineUri = await getOfflinePlaybackUri(id, session.user.id);
        if (cancelled) return;
        if (offlineUri) {
          setPlaylistUrl(offlineUri);
          setSource('offline');
          const record = await getDownloadRecord(id, session.user.id);
          setTitle(record?.videoTitle || id);
          return;
        }

        const access = await getVideoAccess(id, session.accessToken);
        if (cancelled) return;
        setTitle(access?.video?.title || id);
        const url = access?.video?.playlistUrl || access?.playlistUrl;
        if (!url) throw new Error('No playlist URL returned');
        const absolute = url.startsWith('http') ? url : `${apiUrl}${url}`;
        setPlaylistUrl(absolute);
        setSource('online');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Playback failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, id, refreshDownload]);

  const player = useVideoPlayer(playlistUrl, (p) => {
    p.loop = false;
    if (playlistUrl) p.play();
  });

  if (!session) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Sign in required</Text>
      </View>
    );
  }

  async function onDownload() {
    if (!session || !id) return;
    const epoch = accountEpochRef.current;
    const userId = session.user.id;
    const accessToken = session.accessToken;
    setDownloadBusy(true);
    setError(null);
    try {
      await startOfflineDownload({
        accessToken,
        userId,
        videoId: id,
        rendition: DEFAULT_RENDITION,
      });
      if (!isCurrentAccount(epoch, userId)) return;
      await refreshDownload();
      if (!isCurrentAccount(epoch, userId)) return;
      const offlineUri = await getOfflinePlaybackUri(id, userId);
      if (!isCurrentAccount(epoch, userId)) return;
      if (offlineUri) {
        setPlaylistUrl(offlineUri);
        setSource('offline');
      }
    } catch (err) {
      if (isCurrentAccount(epoch, userId)) {
        setError(err instanceof Error ? err.message : 'Download failed');
        await refreshDownload();
      }
    } finally {
      setDownloadBusy(false);
    }
  }

  async function onPause() {
    if (!session || !id) return;
    await pauseOfflineDownload(id, session.user.id);
    await refreshDownload();
  }

  async function onRemove() {
    if (!session || !id) return;
    const epoch = accountEpochRef.current;
    const userId = session.user.id;
    const accessToken = session.accessToken;
    setDownloadBusy(true);
    try {
      await removeOfflineDownload(accessToken, id, userId);
      if (!isCurrentAccount(epoch, userId)) return;
      setProgress(null);
      setPlaylistUrl(null);
      setSource(null);
      await refreshDownload();
      if (!isCurrentAccount(epoch, userId)) return;
      try {
        const access = await getVideoAccess(id, accessToken);
        if (!isCurrentAccount(epoch, userId)) return;
        const url = access?.video?.playlistUrl || access?.playlistUrl;
        if (url) {
          const absolute = url.startsWith('http') ? url : `${apiUrl}${url}`;
          setPlaylistUrl(absolute);
          setSource('online');
        }
      } catch (err) {
        if (isCurrentAccount(epoch, userId)) {
          setError(err instanceof Error ? err.message : 'Could not restore online playback');
        }
      }
    } catch (err) {
      if (isCurrentAccount(epoch, userId)) {
        setError(err instanceof Error ? err.message : 'Remove failed');
      }
    } finally {
      setDownloadBusy(false);
    }
  }

  const status = progress?.status ?? download?.status;
  const active = isDownloadActive(id, session.user.id);
  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.bytesDownloaded / progress.totalBytes) * 100))
      : download && download.totalBytes > 0
        ? Math.min(100, Math.round((download.bytesDownloaded / download.totalBytes) * 100))
        : null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title || 'Watch'}</Text>
      {source ? (
        <Text style={styles.badge}>
          {source === 'offline' ? 'Playing offline' : 'Streaming online'}
        </Text>
      ) : null}
      {loading ? <ActivityIndicator color="#38bdf8" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {playlistUrl ? (
        <VideoView
          style={styles.video}
          player={player}
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture
        />
      ) : null}

      <View style={styles.downloadPanel}>
        <Text style={styles.panelTitle}>Offline download</Text>
        <Text style={styles.hint}>
          Saves {DEFAULT_RENDITION} HLS to this device via the same authorize/assets APIs as the
          PWA.
        </Text>
        {status ? (
          <Text style={styles.muted}>
            Status: {status}
            {pct !== null ? ` · ${pct}%` : ''}
          </Text>
        ) : null}
        {download?.errorMessage ? <Text style={styles.error}>{download.errorMessage}</Text> : null}

        <View style={styles.actions}>
          {status !== 'completed' && status !== 'downloading' && !active ? (
            <Pressable
              style={[styles.primaryBtn, downloadBusy && styles.disabled]}
              disabled={downloadBusy}
              onPress={() => void onDownload()}
            >
              <Text style={styles.primaryBtnText}>
                {status === 'paused' || status === 'failed' ? 'Resume download' : 'Download'}
              </Text>
            </Pressable>
          ) : null}
          {(status === 'downloading' || active) && (
            <Pressable style={styles.secondaryBtn} onPress={() => void onPause()}>
              <Text style={styles.secondaryBtnText}>Pause</Text>
            </Pressable>
          )}
          {download ? (
            <Pressable
              style={[styles.secondaryBtn, downloadBusy && styles.disabled]}
              disabled={downloadBusy}
              onPress={() => void onRemove()}
            >
              <Text style={styles.secondaryBtnText}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700' },
  badge: {
    alignSelf: 'flex-start',
    color: '#e0f2fe',
    backgroundColor: '#0c4a6e',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 8 },
  error: { color: '#f87171' },
  hint: { color: '#64748b', fontSize: 13, lineHeight: 18 },
  muted: { color: '#94a3b8', fontSize: 14 },
  downloadPanel: {
    marginTop: 8,
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  panelTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  primaryBtnText: { color: '#f8fafc', fontWeight: '600' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  secondaryBtnText: { color: '#cbd5e1', fontSize: 14 },
  disabled: { opacity: 0.5 },
});
