import '../global.css';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startHub, stopHub } from '../lib/hub';
import { ensureBatteryExemption } from '../lib/foregroundService';
import { logEnvStatus } from '../lib/env';

export default function RootLayout() {
  // The hub display should never sleep (Phase 6).
  useKeepAwake();

  // Start device discovery + the local HTTP server for the phone (Phase 3),
  // and make sure the OS won't suspend us in the background (reliability).
  useEffect(() => {
    logEnvStatus();
    void ensureBatteryExemption();
    startHub();
    return () => stopHub();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#14140F' },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
      </Stack>
    </SafeAreaProvider>
  );
}
