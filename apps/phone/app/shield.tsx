import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { tapHaptic, strongHaptic } from '../lib/haptics';

type Phase = 'idle' | 'pairing' | 'entering' | 'working';

/** Full-screen Nvidia Shield remote: pairing, then a D-pad + transport remote. */
export default function ShieldScreen() {
  const router = useRouter();
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

  // Keep the control channel warm so the first button press isn't slow (the
  // Shield drops idle sockets; re-establishing costs a few seconds otherwise).
  useFocusEffect(
    useCallback(() => {
      if (!reachable) return;
      load();
      void connectShield().catch(() => {});
      const poll = setInterval(load, 5000);
      const warm = setInterval(() => void connectShield().catch(() => {}), 25000);
      return () => {
        clearInterval(poll);
        clearInterval(warm);
      };
    }, [reachable, load]),
  );

  const paired = status ? status.link === 'connected' || status.link === 'disconnected' : false;

  const beginPairing = async () => {
    setPhase('pairing');
    try {
      const r = await startShieldPairing();
      if (r.ok) setPhase('entering');
      else {
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
    <SafeAreaView className="flex-1 bg-offWhite">
      {/* Header */}
      <View className="px-6 pt-4 pb-2 flex-row items-center">
        <Pressable onPress={() => router.back()} className="mr-3 active:opacity-60">
          <Ionicons name="chevron-back" size={26} color={theme.ink} />
        </Pressable>
        <Text className="text-ink text-2xl font-bold flex-1">Nvidia Shield</Text>
        <StatusPill status={status} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 8 }}>
        {!reachable ? (
          <View className="items-center mt-20">
            <Ionicons name="cloud-offline" size={40} color={theme.muted} />
            <Text className="text-ink/50 mt-3">Hub unreachable - check Settings.</Text>
          </View>
        ) : status && !status.host ? (
          <View className="items-center mt-20">
            <Ionicons name="tv-outline" size={40} color={theme.muted} />
            <Text className="text-ink/50 mt-3 text-center">
              No Shield found on the network. Set EXPO_PUBLIC_SHIELD_IP on the hub if it isn't
              auto-discovered.
            </Text>
          </View>
        ) : !paired ? (
          <PairingPanel
            phase={phase}
            code={code}
            setCode={setCode}
            onPair={beginPairing}
            onSubmit={submit}
          />
        ) : (
          <Remote status={status} onRefresh={load} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusPill({ status }: { status: ShieldStatus | null }) {
  const theme = useThemeColors();
  const connected = status?.link === 'connected';
  const label =
    status?.link === 'connected'
      ? 'Connected'
      : status?.link === 'pairing'
        ? 'Pairing'
        : status?.link === 'disconnected'
          ? 'Paired'
          : 'Not paired';
  return (
    <View className="flex-row items-center">
      <View
        className="w-2 h-2 rounded-full mr-1.5"
        style={{ backgroundColor: connected ? theme.online : theme.muted }}
      />
      <Text className="text-ink/50 text-xs">{label}</Text>
    </View>
  );
}

function PairingPanel({
  phase,
  code,
  setCode,
  onPair,
  onSubmit,
}: {
  phase: Phase;
  code: string;
  setCode: (s: string) => void;
  onPair: () => void;
  onSubmit: () => void;
}) {
  const theme = useThemeColors();
  return (
    <View className="bg-surface rounded-2xl p-5 border border-line/5 mt-2">
      <Text className="text-ink font-bold text-base mb-1">Pair with your Shield</Text>
      <Text className="text-ink/50 text-sm leading-5 mb-4">
        Tap Pair, then type the 6-character code that appears on your TV. This is a one-time step.
      </Text>

      {phase === 'idle' ? (
        <Pressable
          onPress={onPair}
          className="bg-gold py-3 rounded-xl items-center active:opacity-80 flex-row justify-center"
        >
          <Ionicons name="link" size={18} color={theme.accentInk} />
          <Text className="text-accentInk font-semibold ml-2">Pair</Text>
        </Pressable>
      ) : null}

      {phase === 'pairing' ? (
        <View className="flex-row items-center">
          <ActivityIndicator size="small" color={theme.goldDark} />
          <Text className="text-ink/60 text-sm ml-3">Starting pairing - watch your TV...</Text>
        </View>
      ) : null}

      {phase === 'entering' || phase === 'working' ? (
        <View>
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
              className="flex-1 bg-offWhite rounded-xl px-4 py-3 text-ink text-xl tracking-[4px] border border-line/10"
            />
            <Pressable
              onPress={onSubmit}
              disabled={code.trim().length < 6 || phase === 'working'}
              className="bg-gold px-5 py-3 rounded-xl ml-2 active:opacity-80 disabled:opacity-40"
            >
              {phase === 'working' ? (
                <ActivityIndicator size="small" color={theme.accentInk} />
              ) : (
                <Text className="text-accentInk font-semibold">Pair</Text>
              )}
            </Pressable>
          </View>
          <Text className="text-ink/40 text-xs mt-2">The code is shown on the TV screen.</Text>
        </View>
      ) : null}
    </View>
  );
}

function Remote({ status, onRefresh }: { status: ShieldStatus | null; onRefresh: () => void }) {
  const theme = useThemeColors();
  const [powerBusy, setPowerBusy] = useState(false);

  const press = (key: ShieldKey) => {
    tapHaptic();
    void sendShieldKey(key).then((r) => {
      if (!r.ok && r.error) Alert.alert('Shield', r.error);
    });
  };

  // Power is a toggle on Android TV, so a stray double-tap cancels itself out.
  // Debounce it and refresh the reported power state after pressing.
  const pressPower = () => {
    if (powerBusy) return;
    strongHaptic();
    setPowerBusy(true);
    void sendShieldKey('power').then((r) => {
      if (!r.ok && r.error) Alert.alert('Shield', r.error);
    });
    setTimeout(onRefresh, 1200);
    setTimeout(onRefresh, 2600);
    setTimeout(() => setPowerBusy(false), 1800);
  };

  const powerLabel =
    status?.powered === true ? 'On' : status?.powered === false ? 'Standby' : 'Power';
  const powerColor = status?.powered === true ? theme.online : theme.muted;

  const Btn = ({
    icon,
    keyName,
    size = 24,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    keyName: ShieldKey;
    size?: number;
  }) => (
    <Pressable
      onPress={() => press(keyName)}
      className="w-14 h-14 rounded-full items-center justify-center bg-surface border border-line/10 active:opacity-50"
    >
      <Ionicons name={icon} size={size} color={theme.ink} />
    </Pressable>
  );

  return (
    <View className="items-center">
      {/* Power row with state */}
      <View className="flex-row items-center justify-between w-full mb-6">
        <Pressable
          onPress={pressPower}
          className="flex-row items-center bg-surface border border-line/10 rounded-full pl-3 pr-4 py-2.5 active:opacity-60"
          style={{ opacity: powerBusy ? 0.5 : 1 }}
        >
          <Ionicons name="power" size={20} color={powerColor} />
          <Text className="text-ink font-semibold ml-2">{powerLabel}</Text>
        </Pressable>
        <View className="flex-row" style={{ gap: 12 }}>
          <Btn icon="arrow-undo" keyName="back" size={20} />
          <Btn icon="home" keyName="home" size={20} />
          <Btn icon="menu" keyName="menu" size={20} />
        </View>
      </View>

      {/* D-pad */}
      <View className="items-center my-2">
        <Btn icon="chevron-up" keyName="up" size={30} />
        <View className="flex-row items-center my-3" style={{ gap: 28 }}>
          <Btn icon="chevron-back" keyName="left" size={30} />
          <Pressable
            onPress={() => press('center')}
            className="w-20 h-20 rounded-full items-center justify-center bg-gold active:opacity-80"
          >
            <Text className="text-accentInk font-bold">OK</Text>
          </Pressable>
          <Btn icon="chevron-forward" keyName="right" size={30} />
        </View>
        <Btn icon="chevron-down" keyName="down" size={30} />
      </View>

      {/* Transport */}
      <View className="flex-row items-center justify-center w-full mt-6" style={{ gap: 24 }}>
        <Btn icon="play-back" keyName="rewind" />
        <Btn icon="play" keyName="play_pause" />
        <Btn icon="play-forward" keyName="fast_forward" />
      </View>

      {/* Volume */}
      <View className="flex-row items-center justify-center w-full mt-5" style={{ gap: 24 }}>
        <Btn icon="volume-low" keyName="volume_down" />
        <Btn icon="volume-mute" keyName="mute" />
        <Btn icon="volume-high" keyName="volume_up" />
      </View>

      <Text className="text-ink/30 text-[11px] mt-8 text-center">
        Buttons buzz on press. Power shows the Shield's current state.
      </Text>
    </View>
  );
}
