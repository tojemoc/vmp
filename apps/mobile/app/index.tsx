import { Link, Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { listPublishedVideos } from '../src/api/client';
import { useSession } from '../src/auth/SessionProvider';

type VideoRow = {
  id: string;
  title: string;
  description?: string | null;
  full_duration?: number;
  preview_duration?: number;
};

export default function HomeScreen() {
  const { session, booting, error, logout } = useSession();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setListError(null);
    try {
      const data = await listPublishedVideos(session.accessToken);
      const rows = Array.isArray(data) ? data : data?.videos || [];
      setVideos(rows);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, [session]);

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.email}>{session.user.email}</Text>
        <View style={styles.headerActions}>
          <Link href="/pairing" asChild>
            <Pressable style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Approve TV</Text>
            </Pressable>
          </Link>
          <Pressable style={styles.secondaryBtn} onPress={() => void logout()}>
            <Text style={styles.secondaryBtnText}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {listError ? <Text style={styles.error}>{listError}</Text> : null}
      {loading ? <ActivityIndicator color="#38bdf8" /> : null}

      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading ? <Text style={styles.muted}>No published videos yet.</Text> : null
        }
        renderItem={({ item }) => (
          <Link href={`/watch/${item.id}`} asChild>
            <Pressable style={styles.row}>
              <Text style={styles.title}>{item.title || item.id}</Text>
              {item.description ? (
                <Text style={styles.muted} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  list: { gap: 10, paddingBottom: 40 },
  row: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  title: { color: '#f8fafc', fontSize: 17, fontWeight: '600', marginBottom: 4 },
  muted: { color: '#94a3b8', fontSize: 14 },
  error: { color: '#f87171', fontSize: 14 },
});
