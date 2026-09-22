import { Link } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { frontendHost } from '../config';

function webPricingUrl(): string | null {
  if (!frontendHost) return null;
  const host = frontendHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${host}/pricing`;
}

/**
 * Shown when requireActiveSubscription is on and the signed-in user is not premium.
 * Settings remain reachable so they can sign out.
 */
export function SubscriberLock({ title = 'Subscription required' }: { title?: string }) {
  const { session, refreshEntitlements } = useSession();
  const pricingUrl = webPricingUrl();

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{title}</Text>
      <Text style={styles.copy}>
        This app is available to active subscribers. Sign up or manage your plan on the website,
        then return here — pull to refresh is not required; tap Check subscription after checkout.
      </Text>
      {session ? <Text style={styles.email}>{session.user.email}</Text> : null}

      {pricingUrl ? (
        <Pressable
          style={styles.primaryBtn}
          onPress={() => {
            void Linking.openURL(pricingUrl);
          }}
        >
          <Text style={styles.primaryBtnText}>Open pricing on web</Text>
        </Pressable>
      ) : (
        <Text style={styles.muted}>
          Open the VMP website on this device, go to Pricing, and complete checkout.
        </Text>
      )}

      <Pressable style={styles.secondaryBtn} onPress={() => void refreshEntitlements()}>
        <Text style={styles.secondaryBtnText}>Check subscription</Text>
      </Pressable>

      <Link href="/settings" asChild>
        <Pressable style={styles.linkBtn}>
          <Text style={styles.linkText}>Settings / sign out</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 14, justifyContent: 'center' },
  heading: { color: '#f8fafc', fontSize: 24, fontWeight: '700' },
  copy: { color: '#94a3b8', fontSize: 15, lineHeight: 22 },
  email: { color: '#cbd5e1', fontSize: 14, fontWeight: '600' },
  muted: { color: '#64748b', fontSize: 14, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#f8fafc', fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#cbd5e1', fontSize: 15, fontWeight: '600' },
  linkBtn: { paddingVertical: 8, alignItems: 'center' },
  linkText: { color: '#38bdf8', fontSize: 14 },
});
