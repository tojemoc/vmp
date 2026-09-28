import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SessionProvider } from '../src/auth/SessionProvider';
import {
  ensureOfflinePlaybackServer,
  stopOfflinePlaybackServer,
} from '../src/offline/playbackServer';
import { isTvPlatform } from '../src/platform/tv';

export default function RootLayout() {
  const tv = isTvPlatform();

  useEffect(() => {
    // Offline loopback server is phone-only (Sprint 0: no TV downloads).
    if (Platform.OS === 'web' || tv) return;
    void ensureOfflinePlaybackServer().catch(() => undefined);
    return () => {
      void stopOfflinePlaybackServer();
    };
  }, [tv]);

  return (
    <SessionProvider>
      <StatusBar style="auto" hidden={tv} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#f8fafc',
          contentStyle: { backgroundColor: '#020617' },
          headerShown: !tv,
        }}
      >
        <Stack.Screen name="index" options={{ title: 'VMP' }} />
        <Stack.Screen name="login" options={{ title: 'Sign in' }} />
        <Stack.Screen
          name="auth/verify"
          options={{ title: 'Signing in', headerBackVisible: false }}
        />
        <Stack.Screen
          name="auth/2fa"
          options={{ title: 'Two-factor auth', headerBackVisible: false }}
        />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="downloads" options={{ title: 'Downloads' }} />
        <Stack.Screen name="watch/[videoId]" options={{ title: 'Watch' }} />
        <Stack.Screen name="pairing" options={{ title: 'Approve device' }} />
      </Stack>
    </SessionProvider>
  );
}
