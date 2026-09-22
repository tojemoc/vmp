import { Link, Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { listPublishedVideos } from '../src/api/client';
import { useSession } from '../src/auth/SessionProvider';
import { filterPubliclyListedVideos } from '../src/catalog/publishedVideos';
import { SubscriberLock } from '../src/components/SubscriberLock';
import { requireActiveSubscription } from '../src/features';
import { formatDuration, showsPremiumHint } from '../src/media/formatDuration';
import { catalogThumbnailUrl } from '../src/media/thumbnail';
import { userFacingRequestError } from '../src/network/errors';

type VideoRow = {
  id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  full_duration?: number;
  preview_duration?: number;
  publish_status?: string | null;
  scheduled_publish_at?: string | null;
};

export default function HomeScreen() {
  const { session, booting, error, canBrowseCatalog, subscriptionHydrated } = useSession();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !canBrowseCatalog) return;
    setLoading(true);
    setListError(null);
    try {
      const data = await listPublishedVideos(session.accessToken);
      const rows = Array.isArray(data) ? data : data?.videos || [];
      // Editors get drafts from the API; the consumer catalog must stay published-only.
      setVideos(filterPubliclyListedVideos(rows));
    } catch (err) {
      setListError(userFacingRequestError(err, 'Failed to load videos'));
    } finally {
      setLoading(false);
    }
  }, [session, canBrowseCatalog]);

  useEffect(() => {
    void load();
  }, [load]);

  if (booting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#38bdf8" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  if (requireActiveSubscription && !subscriptionHydrated) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#38bdf8" />
        <Text style={styles.muted}>Checking subscription…</Text>
      </View>
    );
  }

  if (!canBrowseCatalog) {
    return <SubscriberLock />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.email}>{session.user.email}</Text>
        <View style={styles.headerActions}>
          <Link href="/downloads" asChild>
            <Pressable style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Downloads</Text>
            </Pressable>
          </Link>
          <Link href="/settings" asChild>
            <Pressable style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Settings</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {listError ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.error}>{listError}</Text>
          <Link href="/downloads" asChild>
            <Pressable style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Open Downloads</Text>
            </Pressable>
          </Link>
        </View>
      ) : null}
      {loading ? <ActivityIndicator color="#38bdf8" /> : null}

      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading ? <Text style={styles.muted}>No published videos yet.</Text> : null
        }
        renderItem={({ item }) => {
          const thumb = catalogThumbnailUrl(item.thumbnail_url);
          const durationLabel = formatDuration(item.full_duration);
          const premium = showsPremiumHint(item.full_duration, item.preview_duration);
          return (
            <Link href={`/watch/${item.id}`} asChild>
              <Pressable style={styles.row}>
                <View style={styles.thumbWrap}>
                  {thumb ? (
                    <Image
                      source={{ uri: thumb }}
                      style={styles.thumb}
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder]} />
                  )}
                  <Text style={styles.durationBadge}>{durationLabel}</Text>
                  {premium ? (
                    <View style={styles.proBadge}>
                      <Text style={styles.proBadgeText}>PRO</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.title} numberOfLines={2}>
                    {item.title || item.id}
                  </Text>
                  {item.description ? (
                    <Text style={styles.muted} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </Link>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  header: { gap: 8 },
  headerActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  email: { color: '#e2e8f0', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  secondaryBtnText: { color: '#cbd5e1', fontSize: 14 },
  list: { gap: 12, paddingBottom: 40 },
  row: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
  },
  thumbWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#1e293b',
  },
  thumb: { width: '100%', height: '100%' },
  thumbPlaceholder: { backgroundColor: '#1e293b' },
  durationBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.8)',
    color: '#fff',
    fontSize: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  proBadge: {
    position: 'absolute',
    left: 8,
    top: 8,
    backgroundColor: '#eab308',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  proBadgeText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '700',
  },
  rowBody: { padding: 12, gap: 4 },
  title: { color: '#f8fafc', fontSize: 17, fontWeight: '600' },
  muted: { color: '#94a3b8', fontSize: 14 },
  error: { color: '#f87171', fontSize: 14 },
  offlineBanner: { gap: 8 },
});
