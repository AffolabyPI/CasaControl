import { useCallback, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { COLORS, type Device, type PrinterStatus } from '@casacontrol/shared';
import { fetchPrinterStatus, pickAndPrint } from '../lib/controls';
import { useThemeColors } from '../lib/theme';

const STATE_COLOR: Record<PrinterStatus['state'], string> = {
  ready: COLORS.online,
  busy: COLORS.gold,
  stopped: COLORS.danger,
  offline: COLORS.offline,
  unknown: COLORS.muted,
};

/** `printer` is the discovered printer device (needed for direct IPP printing). */
export function PrinterCard({ printer }: { printer: Device | null }) {
  const theme = useThemeColors();
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(() => {
    fetchPrinterStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 15_000);
      return () => clearInterval(t);
    }, [load]),
  );

  const onPrint = async () => {
    if (!printer) {
      Alert.alert('Printer', 'No printer discovered on the network yet.');
      return;
    }
    setPrinting(true);
    try {
      const res = await pickAndPrint(printer);
      if (res.message !== 'Cancelled') Alert.alert('Printer', res.message);
      setTimeout(load, 2_000);
    } finally {
      setPrinting(false);
    }
  };

  const state = status?.state ?? 'unknown';
  const supplies = Object.entries(status?.supplies ?? {});

  return (
    <View className="bg-surface rounded-2xl p-4 mb-3 border border-line/5">
      <View className="flex-row items-center">
        <View
          className="w-11 h-11 rounded-xl items-center justify-center"
          style={{ backgroundColor: '#14140F' }}
        >
          <Ionicons name="print" size={22} color={theme.gold} />
        </View>
        <View className="flex-1 ml-3">
          <Text className="text-ink font-bold text-base" numberOfLines={1}>
            {printer?.name ?? 'Printer'}
          </Text>
          <View className="flex-row items-center mt-0.5">
            <View
              className="w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: STATE_COLOR[state] }}
            />
            <Text className="text-ink/50 text-xs capitalize">
              {status?.stateMessage ?? state}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onPrint}
          disabled={printing}
          className="bg-gold px-4 py-2 rounded-full active:opacity-80 disabled:opacity-40 flex-row items-center"
        >
          {printing ? (
            <ActivityIndicator size="small" color={theme.accentInk} />
          ) : (
            <Ionicons name="document" size={16} color={theme.accentInk} />
          )}
          <Text className="text-accentInk font-semibold ml-1.5 text-sm">Print File</Text>
        </Pressable>
      </View>

      {supplies.length > 0 && (
        <View className="mt-3">
          {supplies.map(([name, level]) => (
            <View key={name} className="mb-1.5">
              <View className="flex-row justify-between">
                <Text className="text-ink/50 text-xs" numberOfLines={1}>
                  {name}
                </Text>
                <Text className="text-ink/50 text-xs">{level}%</Text>
              </View>
              <View className="h-1.5 bg-ink/10 rounded-full mt-0.5 overflow-hidden">
                <View
                  className="h-full bg-gold"
                  style={{ width: `${Math.max(0, Math.min(100, level))}%` }}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
