import '../global.css';

import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createLogger } from '@casacontrol/shared';
import { connectionStore } from '../lib/connection';
import { themeStore, useThemeColors, useIsDark, useThemeVars } from '../lib/theme';
import { useMediaNotification } from '../lib/mediaNotification';
import { logEnvStatus } from '../lib/env';

const log = createLogger('app');

export default function RootLayout() {
  const theme = useThemeColors();
  const isDark = useIsDark();
  const themeVars = useThemeVars();

  // Mirror hub playback into a lock-screen / shade media notification.
  useMediaNotification();

  useEffect(() => {
    log.info('RootLayout mounted');
    logEnvStatus();
    // Apply the saved appearance (system/light/dark) before the UI settles.
    void themeStore
      .getState()
      .hydrate()
      .catch((e) => log.error('theme hydrate failed', String(e)));
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
        {/* A NativeWind-processed core View establishes the CSS-variable scope
            for the whole tree (vars() on GestureHandlerRootView is ignored). */}
        <View style={[{ flex: 1 }, themeVars]}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.offWhite },
            }}
          >
            <Stack.Screen name="(tabs)" />
          </Stack>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
