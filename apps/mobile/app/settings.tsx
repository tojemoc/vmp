import { Link, Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/SessionProvider';

/** Account / device settings — pairing lives here, not in the home header. */
export default function SettingsScreen() {
  const { session, booting, logout } = useSession();

  if (booting) {
    return <View style={styles.container} />;
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Settings</Text>
      <Text style={styles.copy}>{session.user.email}</Text>

      <Link href="/pairing" asChild>
        <Pressable style={styles.row}>
          <Text style={styles.rowTitle}>Approve a TV</Text>
          <Text style={styles.rowHint}>Enter the code shown on the TV to sign it in.</Text>
        </Pressable>
      </Link>

      <Pressable style={styles.secondaryBtn} onPress={() => void logout()}>
        <Text style={styles.secondaryBtnText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 16 },
  heading: { color: '#f8fafc', fontSize: 24, fontWeight: '700' },
  copy: { color: '#94a3b8', fontSize: 15 },
  row: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 4,
  },
  rowTitle: { color: '#f8fafc', fontSize: 17, fontWeight: '600' },
  rowHint: { color: '#94a3b8', fontSize: 14 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#cbd5e1', fontSize: 14 },
});
