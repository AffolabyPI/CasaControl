import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { intToRgb, type GoveeDevice, type GoveeScene, type GoveeDiyScene } from '@casacontrol/shared';
import {
  fetchGoveeDevices,
  fetchGoveeScenes,
  fetchGoveeDiyScenes,
  fetchGoveeState,
  setGoveePower,
  setGoveeBrightness,
  setGoveeColor,
  setGoveeScene,
  setGoveeDiyScene,
  COLOR_PRESETS,
} from '../lib/govee';
import { useConnection } from '../lib/connection';
import { useThemeColors } from '../lib/theme';

const rgbCss = (r: number, g: number, b: number) => `rgb(${r},${g},${b})`;
const UNFILTERED_LIMIT = 48; // scenes shown before the user starts searching

/** Full-screen Govee light control: power, brightness, DIY + built-in scenes. */
export default function GoveeScreen() {
  const router = useRouter();
  const theme = useThemeColors();
  const reachable = useConnection((s) => s.reachable);

  const [devices, setDevices] = useState<GoveeDevice[] | null>(null);
  const [selected, setSelected] = useState<GoveeDevice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [on, setOn] = useState<boolean | null>(null);
  const [brightness, setBrightness] = useState(50);
  const [color, setColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [scenes, setScenes] = useState<GoveeScene[]>([]);
  const [diy, setDiy] = useState<GoveeDiyScene[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const dragging = useRef(false);

  const loadDevices = useCallback(() => {
    fetchGoveeDevices()
      .then((list) => {
        setDevices(list);
        setError(null);
        setSelected((prev) => prev ?? list[0] ?? null);
      })
      .catch((e) => {
        setDevices([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (reachable) loadDevices();
    }, [reachable, loadDevices]),
  );

  const loadDetail = useCallback((d: GoveeDevice) => {
    fetchGoveeState(d.sku, d.device)
      .then((st) => {
        if (st.on !== null) setOn(st.on);
        if (st.brightness !== null && !dragging.current) setBrightness(st.brightness);
        if (st.colorRgb !== null) setColor(intToRgb(st.colorRgb));
      })
      .catch(() => {});
    if (d.capabilities.scenes) {
      fetchGoveeScenes(d.sku, d.device).then(setScenes).catch(() => setScenes([]));
      fetchGoveeDiyScenes(d.sku, d.device).then(setDiy).catch(() => setDiy([]));
    }
  }, []);

  useEffect(() => {
    if (selected) loadDetail(selected);
  }, [selected, loadDetail]);

  const filteredScenes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scenes.slice(0, UNFILTERED_LIMIT);
    return scenes.filter((s) => s.name.toLowerCase().includes(q));
  }, [scenes, query]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!selected) {
    return (
      <SafeAreaView className="flex-1 bg-offWhite">
        <ScreenHeader title="Govee light" onBack={() => router.back()} />
        <View className="items-center mt-20 px-8">
          {devices === null ? (
            <ActivityIndicator color={theme.goldDark} />
          ) : (
            <>
              <Ionicons name="bulb-outline" size={40} color={theme.muted} />
              <Text className="text-ink/50 mt-3 text-center">
                {error
                  ? 'Govee lights unavailable. Set EXPO_PUBLIC_GOVEE_API_KEY on the hub.'
                  : 'No Govee lights on this account.'}
              </Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const caps = selected.capabilities;
  const isOn = on ?? false;
  const swatch = color ?? { r: 255, g: 210, b: 160 };

  const togglePower = () => {
    const next = !isOn;
    setOn(next);
    void run(() => setGoveePower(selected, next));
  };

  return (
    <SafeAreaView className="flex-1 bg-offWhite">
      <ScreenHeader title={selected.name} onBack={() => router.back()}>
        <Pressable
          onPress={togglePower}
          className={`px-4 py-2 rounded-full active:opacity-80 flex-row items-center ${
            isOn ? 'bg-gold' : 'border border-line/20'
          }`}
        >
          <Ionicons name="power" size={16} color={isOn ? theme.accentInk : theme.muted} />
          <Text className={`font-semibold ml-1.5 text-sm ${isOn ? 'text-accentInk' : 'text-ink/60'}`}>
            {isOn ? 'On' : 'Off'}
          </Text>
        </Pressable>
      </ScreenHeader>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Device selector when several lights exist */}
        {devices && devices.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mb-3"
            contentContainerStyle={{ gap: 8 }}
          >
            {devices.map((d) => {
              const active = d.device === selected.device;
              return (
                <Pressable
                  key={d.device}
                  onPress={() => setSelected(d)}
                  className={`px-3 py-1.5 rounded-full ${active ? 'bg-gold/20' : 'border border-line/10'}`}
                >
                  <Text className={`text-xs ${active ? 'text-goldDark font-semibold' : 'text-ink/60'}`}>
                    {d.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Brightness */}
        {caps.brightness ? (
          <View className="bg-surface rounded-2xl px-4 py-3 border border-line/5 mb-3">
            <View className="flex-row items-center">
              <Ionicons name="sunny-outline" size={18} color={theme.muted} />
              <Slider
                style={{ flex: 1, height: 40, marginHorizontal: 8 }}
                minimumValue={1}
                maximumValue={100}
                value={brightness}
                step={1}
                tapToSeek
                minimumTrackTintColor={theme.gold}
                maximumTrackTintColor={theme.track}
                thumbTintColor={theme.goldDark}
                onSlidingStart={() => {
                  dragging.current = true;
                }}
                onValueChange={setBrightness}
                onSlidingComplete={(v) => {
                  dragging.current = false;
                  if (!isOn) setOn(true);
                  void run(() => setGoveeBrightness(selected, v));
                }}
              />
              <Text className="text-ink/50 text-xs w-8 text-right">{Math.round(brightness)}</Text>
            </View>
          </View>
        ) : null}

        {/* Colour presets (hidden for scene-only lights like the Pixel Light) */}
        {caps.colorRgb ? (
          <View className="bg-surface rounded-2xl px-4 py-3 border border-line/5 mb-3">
            <Text className="text-ink/50 text-[11px] uppercase tracking-wider mb-2">Colour</Text>
            <View className="flex-row flex-wrap" style={{ gap: 10 }}>
              {COLOR_PRESETS.map((c) => {
                const [r, g, b] = c.rgb;
                const active = color && color.r === r && color.g === g && color.b === b && isOn;
                return (
                  <Pressable
                    key={c.name}
                    onPress={() => {
                      setColor({ r, g, b });
                      if (!isOn) setOn(true);
                      void run(() => setGoveeColor(selected, r, g, b));
                    }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: rgbCss(r, g, b),
                      borderWidth: active ? 3 : 1,
                      borderColor: active ? theme.goldDark : 'rgba(0,0,0,0.15)',
                    }}
                  />
                );
              })}
            </View>
          </View>
        ) : null}

        {/* DIY / custom scenes (what the user created in the Govee app) */}
        {diy.length > 0 ? (
          <View className="mb-3">
            <Text className="text-ink/60 text-xs uppercase tracking-wider mb-2 ml-1">
              My scenes ({diy.length})
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {diy.map((s) => (
                <Pressable
                  key={`diy-${s.value}`}
                  onPress={() => {
                    if (!isOn) setOn(true);
                    void run(() => setGoveeDiyScene(selected, s));
                  }}
                  className="px-3.5 py-2 rounded-xl bg-gold/20 active:opacity-70"
                >
                  <Text className="text-goldDark text-sm font-semibold">{s.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Built-in scenes with search */}
        {caps.scenes ? (
          <View>
            <View className="flex-row items-center justify-between mb-2 ml-1">
              <Text className="text-ink/60 text-xs uppercase tracking-wider">Scenes</Text>
              <Text className="text-ink/30 text-[11px]">{scenes.length} total</Text>
            </View>
            <View className="flex-row items-center bg-surface rounded-xl px-3 border border-line/10 mb-3">
              <Ionicons name="search" size={16} color={theme.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search scenes..."
                placeholderTextColor={theme.muted}
                className="flex-1 py-2.5 px-2 text-ink"
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} className="active:opacity-60">
                  <Ionicons name="close-circle" size={16} color={theme.muted} />
                </Pressable>
              ) : null}
            </View>

            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {filteredScenes.map((s) => (
                <Pressable
                  key={`${s.id}-${s.paramId}`}
                  onPress={() => {
                    if (!isOn) setOn(true);
                    void run(() => setGoveeScene(selected, s));
                  }}
                  className="px-3.5 py-2 rounded-xl bg-surface border border-line/10 active:opacity-60"
                >
                  <Text className="text-ink text-sm">{s.name}</Text>
                </Pressable>
              ))}
            </View>

            {!query && scenes.length > UNFILTERED_LIMIT ? (
              <Text className="text-ink/40 text-xs mt-3 text-center">
                Showing {UNFILTERED_LIMIT} of {scenes.length}. Search to find the rest.
              </Text>
            ) : null}
            {query && filteredScenes.length === 0 ? (
              <Text className="text-ink/40 text-sm mt-2 text-center">No scenes match "{query}".</Text>
            ) : null}
          </View>
        ) : null}

        {busy ? (
          <ActivityIndicator size="small" color={theme.goldDark} style={{ marginTop: 12 }} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ScreenHeader({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children?: React.ReactNode;
}) {
  const theme = useThemeColors();
  return (
    <View className="px-6 pt-4 pb-2 flex-row items-center">
      <Pressable onPress={onBack} className="mr-3 active:opacity-60">
        <Ionicons name="chevron-back" size={26} color={theme.ink} />
      </Pressable>
      <Text className="text-ink text-2xl font-bold flex-1" numberOfLines={1}>
        {title}
      </Text>
      {children}
    </View>
  );
}
