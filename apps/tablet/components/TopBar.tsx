import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import { COLORS } from '@casacontrol/shared';

export function TopBar() {
  const now = useClock();
  const battery = useBattery();
  const wifi = useWifi();

  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <View className="flex-row items-center justify-between">
      <View>
        <Text className="text-white text-6xl font-light tracking-tight">{time}</Text>
        <Text className="text-white/50 text-lg mt-1">{date}</Text>
      </View>

      <View className="flex-row items-center gap-6">
        <View className="flex-row items-center">
          <Ionicons
            name={wifi ? 'wifi' : 'wifi-outline'}
            size={22}
            color={wifi ? COLORS.gold : COLORS.muted}
          />
          <Text className="text-white/60 ml-2">{wifi ? 'Wi-Fi' : 'No Wi-Fi'}</Text>
        </View>
        <View className="flex-row items-center">
          <Ionicons
            name={batteryIcon(battery)}
            size={22}
            color={battery != null && battery <= 0.2 ? COLORS.danger : COLORS.gold}
          />
          <Text className="text-white/60 ml-2">
            {battery != null ? `${Math.round(battery * 100)}%` : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function batteryIcon(level: number | null): keyof typeof Ionicons.glyphMap {
  if (level == null) return 'battery-dead';
  if (level > 0.66) return 'battery-full';
  if (level > 0.25) return 'battery-half';
  return 'battery-dead';
}

function useClock(): Date {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useBattery(): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    let mounted = true;
    void Battery.getBatteryLevelAsync().then((l) => mounted && setLevel(l));
    const sub = Battery.addBatteryLevelListener(({ batteryLevel }) =>
      setLevel(batteryLevel),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return level;
}

function useWifi(): boolean {
  const [wifi, setWifi] = useState(true);
  useEffect(() => {
    const check = () =>
      void Network.getNetworkStateAsync().then((s) =>
        setWifi(s.type === Network.NetworkStateType.WIFI && !!s.isConnected),
      );
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, []);
  return wifi;
}
