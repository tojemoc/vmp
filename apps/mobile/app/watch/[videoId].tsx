import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { getVideoAccess } from '../../src/api/client';
import { useSession } from '../../src/auth/SessionProvider';
import { apiUrl } from '../../src/config';

export default function WatchScreen() {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const { session } = useSession();
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session || !videoId) return;
      setLoading(true);
      setError(null);
      try {
        const access = await getVideoAccess(String(videoId), session.accessToken);
        if (cancelled) return;
        setTitle(access?.video?.title || String(videoId));
        const url = access?.video?.playlistUrl || access?.playlistUrl;
        if (!url) throw new Error('No playlist URL returned');
        const absolute = url.startsWith('http') ? url : `${apiUrl}${url}`;
        setPlaylistUrl(absolute);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Playback failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, videoId]);

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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title || 'Watch'}</Text>
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
      <Text style={styles.hint}>
        PoC player uses expo-video against the existing HLS proxy. Swap to a native module later if
        needed.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 8 },
  error: { color: '#f87171' },
  hint: { color: '#64748b', fontSize: 13, lineHeight: 18 },
});
