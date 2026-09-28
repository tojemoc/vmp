import { Link, Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../src/auth/SessionProvider';
import { Focusable } from '../src/components/Focusable';
import { isTvPlatform } from '../src/platform/tv';

/** Account / device settings — pairing lives here on phone; TV only needs sign-out. */
export default function SettingsScreen() {
  const { session, booting, logout } = useSession();
  const tv = isTvPlatform();

  if (booting) {
    return <View style={styles.container} />;
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={[styles.container, tv && styles.containerTv]}>
      <Text style={[styles.heading, tv && styles.headingTv]}>Settings</Text>
      <Text style={[styles.copy, tv && styles.copyTv]}>{session.user.email}</Text>

      {!tv ? (
        <>
          <Link href="/downloads" asChild>
            <Pressable style={styles.row}>
              <Text style={styles.rowTitle}>Downloads</Text>
              <Text style={styles.rowHint}>Manage offline videos on this device.</Text>
            </Pressable>
          </Link>

          <Link href="/pairing" asChild>
            <Pressable style={styles.row}>
              <Text style={styles.rowTitle}>Approve a TV</Text>
              <Text style={styles.rowHint}>Enter the code shown on the TV to sign it in.</Text>
            </Pressable>
          </Link>
        </>
      ) : (
        <Text style={styles.copyTv}>
          To sign in on another TV, use Settings → Approve a TV on your phone.
        </Text>
      )}

      {tv ? (
        <Focusable
          preferredFocus
          style={styles.secondaryBtn}
          focusedStyle={styles.secondaryBtnFocused}
          onPress={() => void logout()}
        >
          <Text style={styles.secondaryBtnText}>Sign out</Text>
        </Focusable>
      ) : (
        <Pressable style={styles.secondaryBtn} onPress={() => void logout()}>
          <Text style={styles.secondaryBtnText}>Sign out</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 16 },
  containerTv: { paddingHorizontal: 48, paddingVertical: 36, gap: 20 },
  heading: { color: '#f8fafc', fontSize: 24, fontWeight: '700' },
  headingTv: { fontSize: 32 },
  copy: { color: '#94a3b8', fontSize: 15 },
  copyTv: { color: '#94a3b8', fontSize: 20, lineHeight: 28, maxWidth: 720 },
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
    borderWidth: 2,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    maxWidth: 320,
  },
  secondaryBtnFocused: {
    borderColor: '#38bdf8',
    backgroundColor: '#0f172a',
  },
  secondaryBtnText: { color: '#cbd5e1', fontSize: 14 },
});
