import { useCallback } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { connectionStore, useConnection } from '../lib/connection';
import { useThemeColors } from '../lib/theme';

/** Small connection badge + latency, driven by the app-wide health monitor. */
export function ConnectionBadge() {
  const mode = useConnection((s) => s.mode);
  const activeEndpoint = useConnection((s) => s.activeEndpoint);
  const reachable = useConnection((s) => s.reachable);
  const connecting = useConnection((s) => s.connecting);
  const latencyMs = useConnection((s) => s.latencyMs);
  const theme = useThemeColors();

  // The monitor runs continuously; just nudge an immediate probe on focus.
  useFocusEffect(
    useCallback(() => {
      void connectionStore.getState().ping();
    }, []),
  );

  // Show the endpoint actually in use; flag when failover picked the other one.
  const shown = activeEndpoint ?? mode;
  const label = shown === 'remote' ? 'Remote' : 'Local';
  const failedOver = reachable && activeEndpoint != null && activeEndpoint !== mode;
  const dot = reachable ? theme.online : connecting ? theme.gold : theme.danger;

  return (
    <View className="flex-row items-center bg-surface rounded-full px-3 py-1.5 border border-line/5">
      <View className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: dot }} />
      <Text className="text-ink text-xs font-semibold">{label}</Text>
      {failedOver ? <Text className="text-ink/40 text-xs ml-1">(failover)</Text> : null}
      {reachable && latencyMs != null ? (
        <Text className="text-ink/40 text-xs ml-1.5">{latencyMs} ms</Text>
      ) : (
        <Text className="text-ink/40 text-xs ml-1.5">{connecting ? '…' : 'offline'}</Text>
      )}
    </View>
  );
}
