import type { OfflineRendition } from '@vmp/shared';
import { useEventListener } from 'expo';
import { Link, Redirect, router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, type VideoSource, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  getVideoAccess,
  getVideoRecommendations,
  type RecommendationVideo,
} from '../../src/api/client';
import { useSession } from '../../src/auth/SessionProvider';
import { Focusable } from '../../src/components/Focusable';
import { SubscriberLock } from '../../src/components/SubscriberLock';
import { apiUrl } from '../../src/config';
import { requireActiveSubscription } from '../../src/features';
import { formatDuration, showsPremiumHint } from '../../src/media/formatDuration';
import { catalogThumbnailUrl } from '../../src/media/thumbnail';
import {
  OFFLINE_MODE_MESSAGE,
  OFFLINE_PLAYBACK_FAILED_MESSAGE,
  userFacingRequestError,
} from '../../src/network/errors';
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
import { isTvPlatform } from '../../src/platform/tv';

const DEFAULT_RENDITION: OfflineRendition = '720p';

function toHlsSource(uri: string | null): VideoSource | null {
  if (!uri) return null;
  return {
    uri,
    contentType: 'hls',
    useCaching: false,
  };
}

export default function WatchScreen() {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const { session, booting, canBrowseCatalog, subscriptionHydrated } = useSession();
  const tv = isTvPlatform();
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [source, setSource] = useState<'online' | 'offline' | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [fullDuration, setFullDuration] = useState<number | null>(null);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const [hasAccess, setHasAccess] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [download, setDownload] = useState<StoredDownload | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [recommendations, setRecommendations] = useState<RecommendationVideo[]>([]);
  const [playing, setPlaying] = useState(true);

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
    if (tv || !id || !accountId) return;
    const userId = accountId;
    return subscribeDownloadProgress(id, (p) => {
      if (p.userId !== userId) return;
      setProgress(p);
      void refreshDownload();
    });
  }, [id, refreshDownload, accountId, tv]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session || !id || !canBrowseCatalog) return;
      setLoading(true);
      setError(null);
      try {
        // Offline downloads are a Tier 1 phone feature — skip on TV (Sprint 0 non-goal).
        if (!tv) {
          await refreshDownload();
          const offlineUri = await getOfflinePlaybackUri(id, session.user.id);
          if (cancelled) return;
          if (offlineUri) {
            setPlaylistUrl(offlineUri);
            setSource('offline');
            const record = await getDownloadRecord(id, session.user.id);
            setTitle(record?.videoTitle || id);
            setDescription('');
            setHasAccess(true);
            return;
          }
        }

        const access = await getVideoAccess(id, session.accessToken);
        if (cancelled) return;
        setTitle(access?.video?.title || id);
        setDescription(
          typeof access?.video?.description === 'string' ? access.video.description : '',
        );
        setFullDuration(
          typeof access?.video?.fullDuration === 'number' ? access.video.fullDuration : null,
        );
        setPreviewDuration(
          typeof access?.video?.previewDuration === 'number' ? access.video.previewDuration : null,
        );
        setHasAccess(access?.hasAccess !== false);
        const url = access?.video?.playlistUrl || access?.playlistUrl;
        if (!url) throw new Error('No playlist URL returned');
        const absolute = url.startsWith('http') ? url : `${apiUrl}${url}`;
        setPlaylistUrl(absolute);
        setSource('online');

        try {
          const rec = await getVideoRecommendations(id, session.accessToken, 8);
          if (!cancelled) setRecommendations(Array.isArray(rec?.videos) ? rec.videos : []);
        } catch {
          if (!cancelled) setRecommendations([]);
        }
      } catch (err) {
        if (!cancelled) {
          if (!tv) {
            const record = await getDownloadRecord(id, session.user.id).catch(() => null);
            if (record?.status === 'completed') {
              setError(
                `${OFFLINE_MODE_MESSAGE} This download could not be prepared for playback — try Remove and download again while online.`,
              );
            } else {
              setError(userFacingRequestError(err, 'Playback failed'));
            }
          } else {
            setError(userFacingRequestError(err, 'Playback failed'));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, id, refreshDownload, canBrowseCatalog, tv]);

  const videoSource = useMemo(() => toHlsSource(playlistUrl), [playlistUrl]);
  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = false;
    if (videoSource) p.play();
  });

  useEventListener(player, 'statusChange', ({ status, error: playerError }) => {
    if (status !== 'error') return;
    // Do not surface native Error.message in the UI (may leak internals).
    if (source === 'offline') {
      setError(OFFLINE_PLAYBACK_FAILED_MESSAGE);
      return;
    }
    setError(userFacingRequestError(playerError, 'Playback failed'));
  });

  if (booting || (session && requireActiveSubscription && !subscriptionHydrated)) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#38bdf8" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  if (!canBrowseCatalog) {
    return <SubscriberLock title="Subscribe to watch" />;
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
        setError(userFacingRequestError(err, 'Download failed'));
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
        setTitle(access?.video?.title || id);
        setDescription(
          typeof access?.video?.description === 'string' ? access.video.description : '',
        );
        setFullDuration(
          typeof access?.video?.fullDuration === 'number' ? access.video.fullDuration : null,
        );
        setPreviewDuration(
          typeof access?.video?.previewDuration === 'number' ? access.video.previewDuration : null,
        );
        setHasAccess(access?.hasAccess !== false);
        const url = access?.video?.playlistUrl || access?.playlistUrl;
        if (url) {
          const absolute = url.startsWith('http') ? url : `${apiUrl}${url}`;
          setPlaylistUrl(absolute);
          setSource('online');
        }
      } catch (err) {
        if (isCurrentAccount(epoch, userId)) {
          setError(userFacingRequestError(err, 'Could not restore online playback'));
        }
      }
    } catch (err) {
      if (isCurrentAccount(epoch, userId)) {
        setError(userFacingRequestError(err, 'Remove failed'));
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

  const descLong = description.trim().length > 160;
  const shownDescription =
    descriptionExpanded || !descLong ? description.trim() : `${description.trim().slice(0, 160)}…`;
  const accessLabel = !hasAccess
    ? `Preview · ${formatDuration(previewDuration)}`
    : formatDuration(fullDuration);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.container, tv && styles.containerTv]}
    >
      <Text style={[styles.title, tv && styles.titleTv]}>{title || 'Watch'}</Text>
      <View style={styles.metaRow}>
        {source ? (
          <Text style={styles.badge}>
            {source === 'offline' ? 'Playing offline' : 'Streaming online'}
          </Text>
        ) : null}
        {accessLabel !== '--' ? <Text style={styles.metaMuted}>{accessLabel}</Text> : null}
        {!hasAccess || showsPremiumHint(fullDuration, previewDuration) ? (
          <Text style={styles.proChip}>PRO</Text>
        ) : null}
      </View>

      {loading ? <ActivityIndicator color="#38bdf8" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {playlistUrl ? (
        <VideoView
          style={[styles.video, tv && styles.videoTv]}
          player={player}
          fullscreenOptions={{ enable: !tv }}
          allowsPictureInPicture={!tv}
          nativeControls={!tv}
        />
      ) : null}

      {tv && playlistUrl ? (
        <View style={styles.tvTransport}>
          <Focusable
            preferredFocus
            style={styles.tvBtn}
            focusedStyle={styles.tvBtnFocused}
            onPress={() => {
              if (playing) {
                player.pause();
                setPlaying(false);
              } else {
                player.play();
                setPlaying(true);
              }
            }}
          >
            <Text style={styles.tvBtnText}>{playing ? 'Pause' : 'Play'}</Text>
          </Focusable>
          <Focusable
            style={styles.tvBtnSecondary}
            focusedStyle={styles.tvBtnFocused}
            onPress={() => router.back()}
          >
            <Text style={styles.tvBtnTextSecondary}>Back to catalog</Text>
          </Focusable>
        </View>
      ) : null}

      {shownDescription ? (
        <View style={styles.descriptionBlock}>
          <Text style={styles.description}>{shownDescription}</Text>
          {descLong ? (
            <Pressable onPress={() => setDescriptionExpanded((v) => !v)}>
              <Text style={styles.readMore}>{descriptionExpanded ? 'Show less' : 'Read more'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!tv ? (
        <View style={styles.downloadPanel}>
          <Text style={styles.panelTitle}>Offline download</Text>
          <Text style={styles.hint}>
            Saves {DEFAULT_RENDITION} HLS to this device via the same authorize/assets APIs as the
            PWA. Playback uses a local HTTP server (required on iOS).
          </Text>
          {status ? (
            <Text style={styles.muted}>
              Status: {status}
              {pct !== null ? ` · ${pct}%` : ''}
            </Text>
          ) : null}
          {download?.errorMessage ? (
            <Text style={styles.error}>{download.errorMessage}</Text>
          ) : null}

          <View style={styles.actions}>
            {status !== 'completed' && status !== 'downloading' && !active ? (
              <Pressable
                style={[styles.primaryBtn, (downloadBusy || !hasAccess) && styles.disabled]}
                disabled={downloadBusy || !hasAccess}
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
      ) : null}

      {recommendations.length > 0 ? (
        <View style={styles.upNext}>
          <Text style={styles.panelTitle}>Up next</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recList}
          >
            {recommendations.map((item, index) => {
              const thumb = catalogThumbnailUrl(item.thumbnail_url);
              const card = (
                <>
                  <View style={styles.recThumbWrap}>
                    {thumb ? (
                      <Image source={{ uri: thumb }} style={styles.recThumb} />
                    ) : (
                      <View style={[styles.recThumb, styles.thumbPlaceholder]} />
                    )}
                    <View style={styles.recDuration}>
                      <Text style={styles.recDurationText}>
                        {formatDuration(item.full_duration)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.recTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                </>
              );
              if (tv) {
                return (
                  <Focusable
                    key={item.id}
                    preferredFocus={!playlistUrl && index === 0}
                    style={styles.recCard}
                    focusedStyle={styles.recCardFocused}
                    onPress={() => router.push(`/watch/${item.id}`)}
                  >
                    {card}
                  </Focusable>
                );
              }
              return (
                <Link key={item.id} href={`/watch/${item.id}`} asChild>
                  <Pressable style={styles.recCard}>{card}</Pressable>
                </Link>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  containerTv: { paddingHorizontal: 48, paddingVertical: 28, gap: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700' },
  titleTv: { fontSize: 28 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
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
  metaMuted: { color: '#94a3b8', fontSize: 13 },
  proChip: {
    color: '#000',
    backgroundColor: '#eab308',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: '700',
  },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 8 },
  videoTv: { maxHeight: 520, borderRadius: 12 },
  tvTransport: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  tvBtn: {
    backgroundColor: '#38bdf8',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: 'transparent',
    minWidth: 160,
    alignItems: 'center',
  },
  tvBtnSecondary: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#334155',
    minWidth: 200,
    alignItems: 'center',
  },
  tvBtnFocused: {
    borderColor: '#f8fafc',
    transform: [{ scale: 1.05 }],
  },
  tvBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 18 },
  tvBtnTextSecondary: { color: '#e2e8f0', fontWeight: '600', fontSize: 18 },
  descriptionBlock: { gap: 6 },
  description: { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
  readMore: { color: '#38bdf8', fontSize: 14, fontWeight: '600' },
  error: { color: '#f87171' },
  hint: { color: '#64748b', fontSize: 13, lineHeight: 18 },
  muted: { color: '#94a3b8', fontSize: 14 },
  downloadPanel: {
    marginTop: 4,
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
  upNext: { gap: 10, marginTop: 8 },
  recList: { gap: 10 },
  recCard: {
    width: 160,
    gap: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 10,
    padding: 4,
  },
  recCardFocused: { borderColor: '#38bdf8' },
  recThumbWrap: {
    width: 160,
    height: 90,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1e293b',
  },
  recThumb: { width: '100%', height: '100%' },
  thumbPlaceholder: { backgroundColor: '#1e293b' },
  recDuration: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  recDurationText: { color: '#fff', fontSize: 11 },
  recTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
});
