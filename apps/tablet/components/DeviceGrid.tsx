import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, type Device } from '@casacontrol/shared';
import { useDeviceStore } from '../lib/discovery/store';

/** "just now" / "12s ago" / "3m ago" for the last successful scan. */
function timeAgo(ts: number | null): string {
  if (!ts) return 'never';
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  chromecast: 'tv',
  airplay: 'tv',
  spotify: 'musical-notes',
  printer: 'print',
  ps5: 'game-controller',
  ps4: 'game-controller',
  generic: 'hardware-chip',
};

export function DeviceGrid() {
  const devices = useDeviceStore((s) => s.devices);
  const scanning = useDeviceStore((s) => s.scanning);
  const lastScanAt = useDeviceStore((s) => s.lastScanAt);
  const scanNow = useDeviceStore((s) => s.scanNow);

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-gold text-xs uppercase tracking-[3px]">Connected Devices</Text>
        <TouchableOpacity
          onPress={() => void scanNow()}
          disabled={scanning}
          className="flex-row items-center gap-1.5"
        >
          {scanning ? (
            <>
              <ActivityIndicator size="small" color={COLORS.gold} />
              <Text className="text-gold/70 text-xs">scanning…</Text>
            </>
          ) : (
            <>
              <Ionicons name="refresh" size={13} color={COLORS.gold} />
              <Text className="text-white/40 text-xs">
                {devices.length} found · {timeAgo(lastScanAt)}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {devices.length === 0 ? (
        <Text className="text-white/30 text-sm">
          {scanning ? 'Scanning your network…' : 'No devices discovered yet.'}
        </Text>
      ) : (
        <View className="flex-row flex-wrap gap-3">
          {devices.slice(0, 12).map((d) => (
            <DeviceTile key={d.id} device={d} />
          ))}
        </View>
      )}
    </View>
  );
}

function DeviceTile({ device }: { device: Device }) {
  return (
    <View className="w-28 h-24 bg-ink-soft rounded-2xl border border-white/5 p-3 justify-between">
      <View className="flex-row justify-between items-start">
        <Ionicons
          name={KIND_ICON[device.kind] ?? 'hardware-chip'}
          size={24}
          color={COLORS.gold}
        />
        <View
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: device.online ? COLORS.online : COLORS.offline }}
        />
      </View>
      <Text className="text-white/80 text-xs" numberOfLines={1}>
        {device.name}
      </Text>
    </View>
  );
}
