import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@casacontrol/shared';
import { runCommand } from '../lib/hub';
import { deviceStore } from '../lib/discovery/store';
import { store as spotify } from '../lib/spotify';

interface QuickAction {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  run: () => Promise<unknown>;
}

/** Configurable quick-action shortcuts for the hub. */
const ACTIONS: QuickAction[] = [
  {
    key: 'wake-ps5',
    label: 'Wake PS5',
    icon: 'game-controller',
    run: () => runCommand({ action: 'ps5.wake' }),
  },
  {
    key: 'pause-music',
    label: 'Pause Music',
    icon: 'pause',
    run: () => spotify.getState().pause(),
  },
  {
    key: 'play-music',
    label: 'Play Music',
    icon: 'play',
    run: () => spotify.getState().play(),
  },
  {
    key: 'rescan',
    label: 'Scan Devices',
    icon: 'refresh',
    run: () => deviceStore.getState().scanNow(),
  },
];

export function QuickActions() {
  return (
    <View>
      <Text className="text-gold text-xs uppercase tracking-[3px] mb-3">Quick Actions</Text>
      <View className="flex-row gap-3">
        {ACTIONS.map((a) => (
          <QuickActionButton key={a.key} action={a} />
        ))}
      </View>
    </View>
  );
}

function QuickActionButton({ action }: { action: QuickAction }) {
  const [busy, setBusy] = useState(false);
  const onPress = async () => {
    setBusy(true);
    try {
      await action.run();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className="flex-1 bg-ink-soft rounded-2xl border border-gold/20 py-4 items-center active:opacity-70"
    >
      {busy ? (
        <ActivityIndicator color={COLORS.gold} />
      ) : (
        <Ionicons name={action.icon} size={26} color={COLORS.gold} />
      )}
      <Text className="text-white/80 text-sm mt-2">{action.label}</Text>
    </Pressable>
  );
}
