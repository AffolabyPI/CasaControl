import '../global.css';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Brightness from 'expo-brightness';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startHub, stopHub } from '../lib/hub';
import { ensureBatteryExemption } from '../lib/foregroundService';
import { hubModeStore, useHubMode } from '../lib/hubMode';
import { acquireHubWakeLock, releaseHubWakeLock } from '../modules/hub-wakelock';
import { logEnvStatus } from '../lib/env';

const KEEP_AWAKE_TAG = 'casacontrol-hub';

export default function RootLayout() {
  const mode = useHubMode();

  // Start device discovery + the local HTTP server for the phone (Phase 3),
  // and make sure the OS won't suspend us in the background (reliability).
  useEffect(() => {
    logEnvStatus();
    void hubModeStore.getState().hydrate();
    void ensureBatteryExemption();
    startHub();
    return () => stopHub();
  }, []);

  // Dashboard keeps the screen on; private releases the wake-lock so the OS
  // sleeps + locks the screen on its timeout (press power for an instant lock).
  // The hub keeps running via the foreground service in both modes. Brightness
  // is handed back to the system either way so the app is never stuck dark.
  useEffect(() => {
    void Brightness.restoreSystemBrightnessAsync().catch(() => {});
    if (mode === 'dashboard') {
      // Screen stays on → its wake lock already keeps the CPU up.
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      releaseHubWakeLock();
    } else {
      try {
        deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch {
        /* tag not active yet */
      }
      // Screen sleeps → hold a partial (CPU-only) lock so multi-second hub work
      // (BLE speaker wake, Spotify handoff) still completes while locked.
      acquireHubWakeLock();
    }
  }, [mode]);

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
