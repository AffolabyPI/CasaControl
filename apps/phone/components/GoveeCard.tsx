import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { intToRgb, type GoveeDevice, type GoveeScene } from '@casacontrol/shared';
import {
  fetchGoveeDevices,
  fetchGoveeScenes,
  fetchGoveeState,
  setGoveePower,
  setGoveeBrightness,
  setGoveeColor,
  setGoveeScene,
  COLOR_PRESETS,
} from '../lib/govee';
import { useConnection } from '../lib/connection';
import { useThemeColors } from '../lib/theme';

const rgbCss = (r: number, g: number, b: number) => `rgb(${r},${g},${b})`;

/**
 * Control card for Govee lights (e.g. the Gaming Pixel Light). Lists the account's
 * lights, then exposes power, brightness, colour presets and dynamic scenes for
 * the selected one. Hidden entirely when the hub has no Govee key configured.
 */
export function GoveeCard() {
  const theme = useThemeColors();
  const reachable = useConnection((s) => s.reachable);

  const [devices, setDevices] = useState<GoveeDevice[] | null>(null);
  const [selected, setSelected] = useState<GoveeDevice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [on, setOn] = useState<boolean | null>(null);
  const [brightness, setBrightness] = useState<number>(50);
  const [color, setColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [scenes, setScenes] = useState<GoveeScene[]>([]);
  const [busy, setBusy] = useState(false);
  const draggingBrightness = useRef(false);

  // Load the device list (once reachable).
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

  // Load the selected light's state + scenes.
  const loadState = useCallback((d: GoveeDevice) => {
    fetchGoveeState(d.sku, d.device)
      .then((st) => {
        if (st.on !== null) setOn(st.on);
        if (st.brightness !== null && !draggingBrightness.current) setBrightness(st.brightness);
        if (st.colorRgb !== null) setColor(intToRgb(st.colorRgb));
      })
      .catch(() => {});
    if (d.capabilities.scenes) {
      fetchGoveeScenes(d.sku, d.device)
        .then(setScenes)
        .catch(() => setScenes([]));
    } else {
      setScenes([]);
    }
  }, []);

  useEffect(() => {
    if (selected) loadState(selected);
  }, [selected, loadState]);

  // Nothing to show: no key configured / no lights on the account.
  if (devices !== null && devices.length === 0) {
    if (!error) return null;
    return (
      <View className="bg-surface rounded-2xl p-4 mb-3 border border-line/5">
        <View className="flex-row items-center">
          <Ionicons name="bulb-outline" size={20} color={theme.muted} />
          <Text className="text-ink/60 text-sm ml-3 flex-1">
            Govee lights unavailable. Set EXPO_PUBLIC_GOVEE_API_KEY on the hub.
          </Text>
        </View>
      </View>
    );
  }
  if (!selected) {
    return null; // still loading or not reachable
  }

  const caps = selected.capabilities;
  const swatch = color ?? { r: 255, g: 210, b: 160 };
  const isOn = on ?? false;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const togglePower = () => {
    const next = !isOn;
    setOn(next); // optimistic
    void run(() => setGoveePower(selected, next));
  };

  const pickColor = (r: number, g: number, b: number) => {
    setColor({ r, g, b });
    if (!isOn) setOn(true);
    void run(() => setGoveeColor(selected, r, g, b));
  };

  const activateScene = (scene: GoveeScene) => {
    if (!isOn) setOn(true);
    void run(() => setGoveeScene(selected, scene));
  };

  return (
    <View className="bg-surface rounded-2xl p-4 mb-3 border border-line/5">
      {/* Header */}
      <View className="flex-row items-center">
        <View
          className="w-11 h-11 rounded-xl items-center justify-center"
          style={{ backgroundColor: isOn ? rgbCss(swatch.r, swatch.g, swatch.b) : '#14140F' }}
        >
          <Ionicons name="bulb" size={22} color={isOn ? '#14140F' : theme.gold} />
        </View>
        <View className="flex-1 ml-3">
          <Text className="text-ink font-bold text-base" numberOfLines={1}>
            {selected.name}
          </Text>
          <View className="flex-row items-center mt-0.5">
            <View
              className="w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: isOn ? theme.online : theme.offline }}
            />
            <Text className="text-ink/50 text-xs">{isOn ? 'On' : 'Off'}</Text>
          </View>
        </View>
        <Pressable
          onPress={togglePower}
          disabled={busy && on === null}
          className={`px-4 py-2 rounded-full active:opacity-80 flex-row items-center ${
            isOn ? 'bg-gold' : 'border border-line/20'
          }`}
        >
          <Ionicons name="power" size={16} color={isOn ? theme.accentInk : theme.muted} />
          <Text
            className={`font-semibold ml-1.5 text-sm ${isOn ? 'text-accentInk' : 'text-ink/60'}`}
          >
            {isOn ? 'On' : 'Off'}
          </Text>
        </Pressable>
      </View>

      {/* Device selector (only when the account has several lights) */}
      {devices && devices.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
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
        <View className="flex-row items-center mt-3">
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
              draggingBrightness.current = true;
            }}
            onValueChange={(v) => setBrightness(v)}
            onSlidingComplete={(v) => {
              draggingBrightness.current = false;
              if (!isOn) setOn(true);
              void run(() => setGoveeBrightness(selected, v));
            }}
          />
          <Text className="text-ink/50 text-xs w-8 text-right">{Math.round(brightness)}</Text>
        </View>
      ) : null}

      {/* Colour presets */}
      {caps.colorRgb ? (
        <View className="mt-3">
          <Text className="text-ink/50 text-[11px] uppercase tracking-wider mb-2">Colour</Text>
          <View className="flex-row flex-wrap gap-2">
            {COLOR_PRESETS.map((c) => {
              const [r, g, b] = c.rgb;
              const active =
                color && color.r === r && color.g === g && color.b === b && isOn;
              return (
                <Pressable
                  key={c.name}
                  onPress={() => pickColor(r, g, b)}
                  className="rounded-full items-center justify-center"
                  style={{
                    width: 34,
                    height: 34,
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

      {/* Scenes */}
      {caps.scenes && scenes.length > 0 ? (
        <View className="mt-3">
          <Text className="text-ink/50 text-[11px] uppercase tracking-wider mb-2">Scenes</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {scenes.map((s) => (
              <Pressable
                key={`${s.id}-${s.paramId}`}
                onPress={() => activateScene(s)}
                className="px-3 py-1.5 rounded-full bg-gold/15 active:opacity-70"
              >
                <Text className="text-goldDark text-xs font-semibold">{s.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {busy ? (
        <ActivityIndicator size="small" color={theme.goldDark} style={{ marginTop: 8 }} />
      ) : null}
    </View>
  );
}
