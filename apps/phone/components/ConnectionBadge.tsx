import { useCallback } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { connectionStore, useConnection } from '../lib/connection';
import { useThemeColors } from '../lib/theme';

/** Small "Local / Remote" badge + latency ping, shown on the home screen. */
export function ConnectionBadge() {
  const mode = useConnection((s) => s.mode);
  const reachable = useConnection((s) => s.reachable);
  const latencyMs = useConnection((s) => s.latencyMs);
  const theme = useThemeColors();

  useFocusEffect(
    useCallback(() => {
      void connectionStore.getState().ping();
      const t = setInterval(() => void connectionStore.getState().ping(), 5_000);
      return () => clearInterval(t);
    }, []),
  );

  return (
    <View className="flex-row items-center bg-surface rounded-full px-3 py-1.5 border border-line/5">
      <View
        className="w-2 h-2 rounded-full mr-2"
        style={{ backgroundColor: reachable ? theme.online : theme.danger }}
      />
      <Text className="text-ink text-xs font-semibold">
        {mode === 'remote' ? 'Remote' : 'Local'}
      </Text>
      {reachable && latencyMs != null ? (
        <Text className="text-ink/40 text-xs ml-1.5">{latencyMs} ms</Text>
      ) : (
        <Text className="text-ink/40 text-xs ml-1.5">offline</Text>
      )}
    </View>
  );
}
