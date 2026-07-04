import '../global.css';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createLogger } from '@casacontrol/shared';
import { connectionStore } from '../lib/connection';
import { logEnvStatus } from '../lib/env';

const log = createLogger('app');

export default function RootLayout() {
  useEffect(() => {
    log.info('RootLayout mounted');
    logEnvStatus();
    // Load saved hub connection (mode + IPs) and ping it.
    void connectionStore
      .getState()
      .hydrate()
      .catch((e) => log.error('connection hydrate failed', String(e)));
  }, []);

  // GestureHandlerRootView is required for expo-router's Tabs navigator to
  // render on Android — without it the app mounts to a black screen.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#F7F6F2' },
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
