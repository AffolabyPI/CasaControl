import { useCallback, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { COLORS, type Ps5Status } from '@casacontrol/shared';
import { fetchPs5Status, wakePs5 } from '../lib/controls';

const POWER_LABEL: Record<Ps5Status['power'], string> = {
  on: 'On',
  standby: 'Rest mode',
  offline: 'Offline',
  unknown: 'Unknown',
};

const POWER_COLOR: Record<Ps5Status['power'], string> = {
  on: COLORS.online,
  standby: COLORS.gold,
  offline: COLORS.offline,
  unknown: COLORS.muted,
};

export function Ps5Card() {
  const [status, setStatus] = useState<Ps5Status | null>(null);
  const [waking, setWaking] = useState(false);

  const load = useCallback(() => {
    fetchPs5Status()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 10_000);
      return () => clearInterval(t);
    }, [load]),
  );

  const onWake = async () => {
    setWaking(true);
    try {
      const res = await wakePs5();
      if (!res.ok) Alert.alert('PS5', 'Wake failed — is the MAC configured on the hub?');
      setTimeout(load, 4_000);
    } catch (e) {
      Alert.alert('PS5', String(e));
    } finally {
      setWaking(false);
    }
  };

  const power = status?.power ?? 'unknown';

  return (
    <View className="bg-white rounded-2xl p-4 mb-3 border border-black/5">
      <View className="flex-row items-center">
        <View className="w-11 h-11 rounded-xl bg-ink items-center justify-center">
          <Ionicons name="game-controller" size={24} color={COLORS.gold} />
        </View>
        <View className="flex-1 ml-3">
          <Text className="text-ink font-bold text-base">PlayStation 5</Text>
          <View className="flex-row items-center mt-0.5">
            <View
              className="w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: POWER_COLOR[power] }}
            />
            <Text className="text-ink/50 text-xs">{POWER_LABEL[power]}</Text>
          </View>
        </View>
        <Pressable
          onPress={onWake}
          disabled={waking || power === 'on'}
          className="bg-gold px-4 py-2 rounded-full active:opacity-80 disabled:opacity-40 flex-row items-center"
        >
          {waking ? (
            <ActivityIndicator size="small" color={COLORS.ink} />
          ) : (
            <Ionicons name="power" size={16} color={COLORS.ink} />
          )}
          <Text className="text-ink font-semibold ml-1.5 text-sm">Wake</Text>
        </Pressable>
      </View>
      {status?.currentGame ? (
        <Text className="text-ink/60 text-sm mt-3" numberOfLines={1}>
          Playing: <Text className="text-ink font-semibold">{status.currentGame}</Text>
        </Text>
      ) : null}
    </View>
  );
}
