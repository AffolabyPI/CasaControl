import { useCallback, useEffect } from 'react';
import { View, Text, SectionList, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { COLORS, type Device, type DeviceCategory } from '@casacontrol/shared';
import { devicesStore, useDevices } from '../../lib/devices';
import { useConnection } from '../../lib/connection';
import { Ps5Card } from '../../components/Ps5Card';
import { PrinterCard } from '../../components/PrinterCard';

const CATEGORY_META: Record<
  DeviceCategory,
  { title: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  media: { title: 'Media', icon: 'tv' },
  printer: { title: 'Printers', icon: 'print' },
  gaming: { title: 'Gaming', icon: 'game-controller' },
  unknown: { title: 'Unknown', icon: 'help-circle' },
};

const ORDER: DeviceCategory[] = ['media', 'gaming', 'printer', 'unknown'];

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  chromecast: 'tv',
  airplay: 'tv',
  spotify: 'musical-notes',
  printer: 'print',
  ps5: 'game-controller',
  ps4: 'game-controller',
  generic: 'hardware-chip',
};

export default function Devices() {
  const devices = useDevices((s) => s.devices);
  const loading = useDevices((s) => s.loading);
  const error = useDevices((s) => s.error);
  const reachable = useConnection((s) => s.reachable);

  useFocusEffect(
    useCallback(() => {
      void devicesStore.getState().refresh();
      const t = setInterval(() => void devicesStore.getState().refresh(), 15_000);
      return () => clearInterval(t);
    }, []),
  );

  const sections = ORDER.map((category) => ({
    category,
    title: CATEGORY_META[category].title,
    data: devices.filter((d) => d.category === category),
  })).filter((s) => s.data.length > 0);

  const printerDevice = devices.find((d) => d.kind === 'printer') ?? null;

  const pinnedCards = (
    <View className="mb-2">
      <Text className="text-ink/60 text-xs uppercase tracking-wider mb-2">Controls</Text>
      <Ps5Card />
      <PrinterCard printer={printerDevice} />
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-offWhite">
      <View className="px-6 pt-4 pb-2 flex-row items-center justify-between">
        <Text className="text-ink text-3xl font-bold">Devices</Text>
        <View className="flex-row items-center">
          <View
            className="w-2.5 h-2.5 rounded-full mr-2"
            style={{ backgroundColor: reachable ? COLORS.online : COLORS.danger }}
          />
          <Text className="text-ink/50 text-xs">
            {reachable ? 'Hub online' : 'Hub unreachable'}
          </Text>
        </View>
      </View>

      {!reachable && !loading && devices.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="cloud-offline" size={48} color={COLORS.muted} />
          <Text className="text-ink/50 mt-3 text-center">
            Can't reach the hub. Check the tablet is running and the IP in Settings.
          </Text>
          {error ? <Text className="text-danger text-xs mt-2">{error}</Text> : null}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={pinnedCards}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => devicesStore.getState().refresh()}
              tintColor={COLORS.gold}
            />
          }
          renderSectionHeader={({ section }) => (
            <View className="flex-row items-center mt-4 mb-2">
              <Ionicons
                name={CATEGORY_META[section.category as DeviceCategory].icon}
                size={16}
                color={COLORS.goldDark}
              />
              <Text className="text-ink/60 text-xs uppercase tracking-wider ml-2">
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => <DeviceRow device={item} />}
          ListEmptyComponent={
            <Text className="text-ink/40 text-center mt-10">
              No devices discovered yet.
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

function DeviceRow({ device }: { device: Device }) {
  return (
    <Pressable className="flex-row items-center bg-white rounded-xl px-4 py-3 mb-2 border border-black/5 active:opacity-70">
      <Ionicons
        name={KIND_ICON[device.kind] ?? 'hardware-chip'}
        size={22}
        color={COLORS.goldDark}
      />
      <View className="flex-1 ml-3">
        <Text className="text-ink font-semibold" numberOfLines={1}>
          {device.name}
        </Text>
        <Text className="text-ink/40 text-xs">
          {device.ip}
          {device.hostname ? ` · ${device.hostname}` : ''}
        </Text>
      </View>
      <View
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: device.online ? COLORS.online : COLORS.offline }}
      />
    </Pressable>
  );
}
