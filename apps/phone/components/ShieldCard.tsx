import { useCallback, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import type { ShieldKey, ShieldStatus } from '@casacontrol/shared';
import {
  fetchShieldStatus,
  startShieldPairing,
  submitShieldCode,
  connectShield,
  sendShieldKey,
} from '../lib/shield';
import { useConnection } from '../lib/connection';
import { useThemeColors } from '../lib/theme';

type Phase = 'idle' | 'pairing' | 'entering' | 'working';

/**
 * Nvidia Shield / Android TV card: a one-time pairing flow (the TV shows a code
 * to type back), then a full remote — power, D-pad, transport and volume. Hidden
 * when the hub reports no Shield configured/discovered.
 */
export function ShieldCard() {
  const theme = useThemeColors();
  const reachable = useConnection((s) => s.reachable);

  const [status, setStatus] = useState<ShieldStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState('');

  const load = useCallback(() => {
    fetchShieldStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!reachable) return;
      load();
      const t = setInterval(load, 8000);
      return () => clearInterval(t);
    }, [reachable, load]),
  );

  // No Shield host known to the hub → don't render the card at all.
  if (status && !status.host) return null;
  if (!status) return null;

  const paired = status.link === 'connected' || status.link === 'disconnected';
  const linkLabel =
    status.link === 'connected'
      ? 'Connected'
      : status.link === 'pairing'
        ? 'Pairing…'
        : paired
          ? 'Paired'
          : 'Not paired';

  const beginPairing = async () => {
    setPhase('pairing');
    try {
      const r = await startShieldPairing();
      if (r.ok) {
        setPhase('entering');
      } else {
        setPhase('idle');
        Alert.alert('Shield', r.error ?? 'Could not start pairing');
      }
    } catch (e) {
      setPhase('idle');
      Alert.alert('Shield', String(e));
    }
  };

  const submit = async () => {
    setPhase('working');
    try {
      const r = await submitShieldCode(code.trim());
      if (r.ok) {
        setCode('');
        setPhase('idle');
        void connectShield();
        setTimeout(load, 800);
      } else {
        setPhase('entering');
        Alert.alert('Shield', r.error ?? 'Pairing failed');
      }
    } catch (e) {
      setPhase('entering');
      Alert.alert('Shield', String(e));
    }
  };

  return (
    <View className="bg-surface rounded-2xl p-4 mb-3 border border-line/5">
      {/* Header */}
      <View className="flex-row items-center">
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
              style={{
                backgroundColor: status.link === 'connected' ? theme.online : theme.muted,
              }}
            />
            <Text className="text-ink/50 text-xs">{linkLabel}</Text>
          </View>
        </View>
        {!paired && phase === 'idle' ? (
          <Pressable
            onPress={beginPairing}
            className="bg-gold px-4 py-2 rounded-full active:opacity-80 flex-row items-center"
          >
            <Ionicons name="link" size={15} color={theme.accentInk} />
            <Text className="text-accentInk font-semibold ml-1.5 text-sm">Pair</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Pairing code entry */}
      {phase === 'pairing' ? (
        <View className="flex-row items-center mt-4">
          <ActivityIndicator size="small" color={theme.goldDark} />
          <Text className="text-ink/60 text-sm ml-3">Starting pairing — watch your TV…</Text>
        </View>
      ) : null}

      {phase === 'entering' || phase === 'working' ? (
        <View className="mt-4">
          <Text className="text-ink/60 text-xs mb-2">
            Enter the 6-character code shown on your TV:
          </Text>
          <View className="flex-row items-center">
            <TextInput
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              placeholder="A1B2C3"
              placeholderTextColor={theme.muted}
              editable={phase === 'entering'}
              className="flex-1 bg-offWhite rounded-xl px-4 py-3 text-ink text-lg tracking-widest border border-line/10"
            />
            <Pressable
              onPress={submit}
              disabled={code.trim().length < 6 || phase === 'working'}
              className="bg-gold px-4 py-3 rounded-xl ml-2 active:opacity-80 disabled:opacity-40"
            >
              {phase === 'working' ? (
                <ActivityIndicator size="small" color={theme.accentInk} />
              ) : (
                <Text className="text-accentInk font-semibold">Pair</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Remote */}
      {paired && phase === 'idle' ? <ShieldRemote onError={(m) => Alert.alert('Shield', m)} /> : null}
    </View>
  );
}

function ShieldRemote({ onError }: { onError: (m: string) => void }) {
  const theme = useThemeColors();
  const press = (key: ShieldKey) => {
    void sendShieldKey(key).then((r) => {
      if (!r.ok && r.error) onError(r.error);
    });
  };

  const Btn = ({
    icon,
    keyName,
    size = 22,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    keyName: ShieldKey;
    size?: number;
  }) => (
    <Pressable
      onPress={() => press(keyName)}
      className="w-12 h-12 rounded-full items-center justify-center bg-offWhite border border-line/10 active:opacity-60"
    >
      <Ionicons name={icon} size={size} color={theme.ink} />
    </Pressable>
  );

  return (
    <View className="mt-4 items-center">
      {/* Top row: power / home / back / menu */}
      <View className="flex-row items-center justify-between w-full mb-4 px-2">
        <Btn icon="power" keyName="power" />
        <Btn icon="home" keyName="home" />
        <Btn icon="arrow-undo" keyName="back" />
        <Btn icon="menu" keyName="menu" />
      </View>

      {/* D-pad */}
      <View className="items-center">
        <Btn icon="chevron-up" keyName="up" size={26} />
        <View className="flex-row items-center my-2" style={{ gap: 24 }}>
          <Btn icon="chevron-back" keyName="left" size={26} />
          <Pressable
            onPress={() => press('center')}
            className="w-16 h-16 rounded-full items-center justify-center bg-gold active:opacity-80"
          >
            <Text className="text-accentInk font-bold text-xs">OK</Text>
          </Pressable>
          <Btn icon="chevron-forward" keyName="right" size={26} />
        </View>
        <Btn icon="chevron-down" keyName="down" size={26} />
      </View>

      {/* Transport */}
      <View className="flex-row items-center justify-center w-full mt-4" style={{ gap: 20 }}>
        <Btn icon="play-back" keyName="rewind" />
        <Btn icon="play" keyName="play_pause" />
        <Btn icon="play-forward" keyName="fast_forward" />
      </View>

      {/* Volume */}
      <View className="flex-row items-center justify-center w-full mt-4" style={{ gap: 20 }}>
        <Btn icon="volume-low" keyName="volume_down" />
        <Btn icon="volume-mute" keyName="mute" />
        <Btn icon="volume-high" keyName="volume_up" />
      </View>
    </View>
  );
}
