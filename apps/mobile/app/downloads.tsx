import { Link, Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/SessionProvider';
import { listDownloadRecords, removeOfflineDownload } from '../src/offline/downloadManager';
import type { StoredDownload } from '../src/offline/types';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DownloadsScreen() {
  const { session, booting } = useSession();
  const [rows, setRows] = useState<StoredDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await listDownloadRecords(session.user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list downloads');
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

  async function onRemove(videoId: string) {
    if (!session) return;
    setBusyId(videoId);
    setError(null);
    try {
      await removeOfflineDownload(session.accessToken, videoId, session.user.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Downloads</Text>
      <Text style={styles.copy}>Offline copies stored on this device. Play without a network.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color="#38bdf8" /> : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.videoId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading ? <Text style={styles.muted}>No offline downloads yet.</Text> : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.title}>{item.videoTitle || item.videoId}</Text>
            <Text style={styles.muted}>
              {item.status} · {item.rendition} · {formatBytes(item.bytesDownloaded)}
              {item.totalBytes > 0 ? ` / ${formatBytes(item.totalBytes)}` : ''}
            </Text>
            {item.errorMessage ? <Text style={styles.error}>{item.errorMessage}</Text> : null}
            <View style={styles.actions}>
              {item.status === 'completed' ? (
                <Link href={`/watch/${item.videoId}`} asChild>
                  <Pressable style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>Play</Text>
                  </Pressable>
                </Link>
              ) : null}
              <Pressable
                style={styles.secondaryBtn}
                disabled={busyId === item.videoId}
                onPress={() => void onRemove(item.videoId)}
              >
                <Text style={styles.secondaryBtnText}>
                  {busyId === item.videoId ? 'Removing…' : 'Remove'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { color: '#f8fafc', fontSize: 24, fontWeight: '700' },
  copy: { color: '#94a3b8', fontSize: 14, lineHeight: 20 },
  list: { gap: 10, paddingBottom: 40 },
  row: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 6,
  },
  title: { color: '#f8fafc', fontSize: 17, fontWeight: '600' },
  muted: { color: '#94a3b8', fontSize: 14 },
  error: { color: '#f87171', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
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
});
