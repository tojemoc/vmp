import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SessionProvider } from '../src/auth/SessionProvider';
import {
  ensureOfflinePlaybackServer,
  stopOfflinePlaybackServer,
} from '../src/offline/playbackServer';

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void ensureOfflinePlaybackServer().catch(() => undefined);
    return () => {
      void stopOfflinePlaybackServer();
    };
  }, []);

  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#f8fafc',
          contentStyle: { backgroundColor: '#020617' },
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
