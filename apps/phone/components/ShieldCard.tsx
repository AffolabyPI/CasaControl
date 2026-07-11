import { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type { ShieldStatus } from '@casacontrol/shared';
import { fetchShieldStatus } from '../lib/shield';
import { useConnection } from '../lib/connection';
import { useThemeColors } from '../lib/theme';

/**
 * Compact Nvidia Shield summary row for the Devices tab — shows pairing/power
 * state and opens the full remote screen on tap. Hidden when no Shield is known.
 */
export function ShieldCard() {
  const router = useRouter();
  const theme = useThemeColors();
  const reachable = useConnection((s) => s.reachable);
  const [status, setStatus] = useState<ShieldStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!reachable) return;
      let alive = true;
      const load = () =>
        fetchShieldStatus()
          .then((s) => alive && setStatus(s))
          .catch(() => {});
      load();
      const t = setInterval(load, 8000);
      return () => {
        alive = false;
        clearInterval(t);
      };
    }, [reachable]),
  );

  // No Shield discovered/configured on the hub → hide the row.
  if (status && !status.host) return null;
  if (!status) return null;

  const connected = status.link === 'connected';
  const paired = connected || status.link === 'disconnected';
  const sub = !paired
    ? 'Not paired - tap to pair'
    : status.powered === true
      ? 'On - tap for remote'
      : status.powered === false
        ? 'Standby - tap for remote'
        : 'Paired - tap for remote';

  return (
    <Pressable
      onPress={() => router.push('/shield' as never)}
      className="flex-row items-center bg-surface rounded-2xl p-4 mb-3 border border-line/5 active:opacity-70"
    >
      <View
        className="w-11 h-11 rounded-xl items-center justify-center"
        style={{ backgroundColor: '#14140F' }}
      >
        <Ionicons name="tv" size={22} color={theme.gold} />
      </View>
      <View className="flex-1 ml-3">
        <Text className="text-ink font-bold text-base">Nvidia Shield</Text>
        <View className="flex-row items-center mt-0.5">
          <View
            className="w-2 h-2 rounded-full mr-1.5"
            style={{ backgroundColor: connected ? theme.online : theme.muted }}
          />
          <Text className="text-ink/50 text-xs">{sub}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.muted} />
    </Pressable>
  );
}
