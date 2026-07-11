import { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type { GoveeDevice } from '@casacontrol/shared';
import { fetchGoveeDevices, fetchGoveeState } from '../lib/govee';
import { useConnection } from '../lib/connection';
import { useThemeColors } from '../lib/theme';

/**
 * Compact Govee summary row for the Devices tab — shows the light and its
 * on/off state, and opens the full control screen on tap. Hidden when the hub
 * has no Govee light configured.
 */
export function GoveeCard() {
  const router = useRouter();
  const theme = useThemeColors();
  const reachable = useConnection((s) => s.reachable);

  const [device, setDevice] = useState<GoveeDevice | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!reachable) return;
      let alive = true;
      fetchGoveeDevices()
        .then((list) => {
          if (!alive) return;
          const d = list[0] ?? null;
          setDevice(d);
          setHidden(!d);
          if (d) fetchGoveeState(d.sku, d.device).then((s) => alive && setOn(s.on)).catch(() => {});
        })
        .catch(() => alive && setHidden(true));
      return () => {
        alive = false;
      };
    }, [reachable]),
  );

  if (hidden || !device) return null;

  return (
    <Pressable
      onPress={() => router.push('/govee' as never)}
      className="flex-row items-center bg-surface rounded-2xl p-4 mb-3 border border-line/5 active:opacity-70"
    >
      <View
        className="w-11 h-11 rounded-xl items-center justify-center"
        style={{ backgroundColor: on ? '#C9A84C' : '#14140F' }}
      >
        <Ionicons name="bulb" size={22} color={on ? '#14140F' : theme.gold} />
      </View>
      <View className="flex-1 ml-3">
        <Text className="text-ink font-bold text-base" numberOfLines={1}>
          {device.name}
        </Text>
        <Text className="text-ink/50 text-xs mt-0.5">
          {on === null ? 'Tap to control' : on ? 'On' : 'Off'} - brightness & scenes
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.muted} />
    </Pressable>
  );
}
