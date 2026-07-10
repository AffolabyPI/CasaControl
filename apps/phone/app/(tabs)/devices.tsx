import { useCallback, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  RefreshControl,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { type Device, type DeviceAction, type DeviceCategory } from '@casacontrol/shared';
import { useRouter } from 'expo-router';
import { devicesStore, useDevices } from '../../lib/devices';
import { useConnection, hubClient } from '../../lib/connection';
import { profilesStore, useProfiles } from '../../lib/profiles';
import { useThemeColors } from '../../lib/theme';
import { Ps5Card } from '../../components/Ps5Card';
import { PrinterCard } from '../../components/PrinterCard';
import { GoveeCard } from '../../components/GoveeCard';
import { ShieldCard } from '../../components/ShieldCard';
import { ProfileReviewModal } from '../../components/ProfileReviewModal';

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
  const theme = useThemeColors();

  const router = useRouter();
  const profileError = useProfiles((s) => s.error);

  useFocusEffect(
    useCallback(() => {
      void devicesStore.getState().refresh();
      void profilesStore.getState().refresh();
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
      <GoveeCard />
      <ShieldCard />
      <PrinterCard printer={printerDevice} />
      <Pressable
        onPress={() => router.push('/profiles' as never)}
        className="flex-row items-center bg-surface rounded-xl px-4 py-3 mt-2 border border-line/5 active:opacity-70"
      >
        <Ionicons name="construct" size={18} color={theme.goldDark} />
        <Text className="text-ink font-semibold ml-3 flex-1">Manage device profiles</Text>
        <Ionicons name="chevron-forward" size={16} color={theme.muted} />
      </Pressable>
      {profileError ? <Text className="text-danger text-xs mt-2">{profileError}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-offWhite">
      <View className="px-6 pt-4 pb-2 flex-row items-center justify-between">
        <Text className="text-ink text-3xl font-bold">Devices</Text>
        <View className="flex-row items-center">
          <View
            className="w-2.5 h-2.5 rounded-full mr-2"
            style={{ backgroundColor: reachable ? theme.online : theme.danger }}
          />
          <Text className="text-ink/50 text-xs">
            {reachable ? 'Hub online' : 'Hub unreachable'}
          </Text>
        </View>
      </View>

      {!reachable && !loading && devices.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="cloud-offline" size={48} color={theme.muted} />
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
              tintColor={theme.gold}
            />
          }
          renderSectionHeader={({ section }) => (
            <View className="flex-row items-center mt-4 mb-2">
              <Ionicons
                name={CATEGORY_META[section.category as DeviceCategory].icon}
                size={16}
                color={theme.goldDark}
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
      <ProfileReviewModal />
    </SafeAreaView>
  );
}

function DeviceRow({ device }: { device: Device }) {
  const theme = useThemeColors();
  // Prefer the model/vendor for the subtitle when we detected one.
  const subtitle =
    device.model ?? (device.vendor ? `${device.vendor} device` : device.hostname ?? '');
  return (
    <View className="bg-surface rounded-xl px-4 py-3 mb-2 border border-line/5">
      <View className="flex-row items-center">
        <Ionicons
          name={KIND_ICON[device.kind] ?? 'hardware-chip'}
          size={22}
          color={theme.goldDark}
        />
        <View className="flex-1 ml-3">
          <Text className="text-ink font-semibold" numberOfLines={1}>
            {device.name}
          </Text>
          <Text className="text-ink/40 text-xs" numberOfLines={1}>
            {device.ip}
            {subtitle ? ` · ${subtitle}` : ''}
          </Text>
        </View>
        <View
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: device.online ? theme.online : theme.offline }}
        />
      </View>

      <DeviceControls device={device} />
    </View>
  );
}

/** Profile-backed executable actions, or a "Try to add control" affordance. */
function DeviceControls({ device }: { device: Device }) {
  const theme = useThemeColors();
  const matched = useProfiles((s) => s.matchFor(device));
  const researching = useProfiles((s) => s.researchingId === device.id);

  if (matched) {
    return (
      <View className="flex-row flex-wrap items-center mt-2.5 ml-8">
        {matched.source === 'ai_generated' ? (
          <View className="bg-gold/20 rounded-full px-2 py-1 mr-2 mb-1">
            <Text className="text-goldDark text-[10px] font-bold uppercase tracking-wide">AI</Text>
          </View>
        ) : null}
        {Object.keys(matched.actions).map((name) => (
          <ProfileActionChip key={name} device={device} profileId={matched.profileId} action={name} />
        ))}
      </View>
    );
  }

  // No profile yet → offer research (this is the ONLY place research is triggered).
  return (
    <View className="flex-row flex-wrap items-center mt-2.5 ml-8">
      {device.suggestedActions?.map((a) => <ActionChip key={a.id} device={device} action={a} />)}
      <Pressable
        onPress={() => void profilesStore.getState().research(device)}
        disabled={researching}
        className="flex-row items-center rounded-full px-3 py-1.5 mr-2 mb-1 border border-gold/40 active:opacity-70"
      >
        {researching ? (
          <ActivityIndicator size="small" color={theme.goldDark} style={{ marginRight: 5 }} />
        ) : (
          <Ionicons name="sparkles" size={13} color={theme.goldDark} style={{ marginRight: 5 }} />
        )}
        <Text className="text-goldDark text-xs font-semibold">
          {researching ? 'Researching…' : 'Try to add control'}
        </Text>
      </Pressable>
    </View>
  );
}

function ProfileActionChip({
  device,
  profileId,
  action,
}: {
  device: Device;
  profileId: string;
  action: string;
}) {
  const theme = useThemeColors();
  const [busy, setBusy] = useState(false);
  const onPress = async () => {
    setBusy(true);
    try {
      const r = await profilesStore.getState().runAction(profileId, action, device);
      if (!r.ok) Alert.alert(action, r.detail);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className="flex-row items-center rounded-full px-3 py-1.5 mr-2 mb-1 bg-gold active:opacity-70"
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.accentInk} style={{ marginRight: 5 }} />
      ) : null}
      <Text className="text-accentInk text-xs font-semibold">{action.replace(/_/g, ' ')}</Text>
    </Pressable>
  );
}

function ActionChip({ device, action }: { device: Device; action: DeviceAction }) {
  const theme = useThemeColors();
  const runnable = !!action.command;

  const onPress = () => {
    if (action.command) {
      hubClient
        .sendCommand(action.command)
        .then((res) => {
          const r = res.result as { ok?: boolean; error?: string } | undefined;
          if (r && r.ok === false) Alert.alert(action.label, r.error ?? 'Command failed');
        })
        .catch((e) => Alert.alert(action.label, String(e)));
    } else {
      Alert.alert(action.label, action.hint ?? `Not wired up for ${device.name} yet.`);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center rounded-full px-3 py-1.5 mr-2 mb-1 active:opacity-70 ${
        runnable ? 'bg-gold' : 'border border-line/10'
      }`}
    >
      {action.icon ? (
        <Ionicons
          name={action.icon as keyof typeof Ionicons.glyphMap}
          size={13}
          color={runnable ? theme.accentInk : theme.muted}
          style={{ marginRight: 5 }}
        />
      ) : null}
      <Text className={`text-xs font-semibold ${runnable ? 'text-accentInk' : 'text-ink/50'}`}>
        {action.label}
      </Text>
    </Pressable>
  );
}
