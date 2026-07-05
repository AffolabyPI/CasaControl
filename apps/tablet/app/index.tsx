import { useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, IDLE_DIM_MS } from '@casacontrol/shared';
import { store, useSpotifyStore, useSpotifyLogin } from '../lib/spotify';
import { useIdleDim } from '../lib/useIdleDim';
import { useHubMode } from '../lib/hubMode';
import { NowPlaying } from '../components/NowPlaying';
import { TopBar } from '../components/TopBar';
import { DeviceGrid } from '../components/DeviceGrid';
import { QuickActions } from '../components/QuickActions';

/**
 * Always-on hub dashboard (Phase 6).
 * Top bar · Now Playing · Connected Devices · Quick Actions.
 * Never sleeps (useKeepAwake in _layout); dims to 20% after 5 min idle.
 */
export default function HubHome() {
  const isAuthed = useSpotifyStore((s) => s.isAuthed);
  const mode = useHubMode();
  const { onActivity } = useIdleDim(0.2, IDLE_DIM_MS, mode === 'dashboard');

  useEffect(() => {
    if (isAuthed) store.getState().startPolling();
    return () => store.getState().stopPolling();
  }, [isAuthed]);

  return (
    <View className="flex-1 bg-ink" onTouchStart={onActivity}>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 32, gap: 28 }}>
          <TopBar />

          <View className="bg-ink-soft/60 rounded-3xl p-6 border border-white/5">
            {isAuthed ? <NowPlaying /> : <SpotifyPrompt />}
          </View>

          <DeviceGrid />
          <QuickActions />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function SpotifyPrompt() {
  const { promptAsync, isReady, clientConfigured } = useSpotifyLogin();
  return (
    <View className="items-center py-6">
      <Ionicons name="musical-notes" size={56} color={COLORS.gold} />
      <Text className="text-white text-xl mt-3">Connect Spotify</Text>
      <Pressable
        disabled={!isReady || !clientConfigured}
        onPress={() => promptAsync()}
        className="mt-5 bg-gold px-8 py-3 rounded-full active:opacity-80 disabled:opacity-40"
      >
        <Text className="text-ink font-semibold">Log in with Spotify</Text>
      </Pressable>
      {!clientConfigured && (
        <Text className="text-danger text-xs mt-3">
          Set EXPO_PUBLIC_SPOTIFY_CLIENT_ID in .env first.
        </Text>
      )}
    </View>
  );
}
