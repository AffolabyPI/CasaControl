import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useThemeColors } from '../../lib/theme';
import { store, useSpotifyStore, useSpotifyLogin } from '../../lib/spotify';
import { hubClient, useConnection } from '../../lib/connection';
import { ConnectionBadge } from '../../components/ConnectionBadge';
import { AssistantFab } from '../../components/AssistantFab';
import { PlaylistPickerModal } from '../../components/PlaylistPickerModal';

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Remote() {
  const isAuthed = useSpotifyStore((s) => s.isAuthed);
  const playback = useSpotifyStore((s) => s.playback);
  const devices = useSpotifyStore((s) => s.devices);
  const error = useSpotifyStore((s) => s.error);
  const { promptAsync, isReady, clientConfigured } = useSpotifyLogin();
  const theme = useThemeColors();

  // Poll only while this screen is focused and we're logged in.
  useFocusEffect(
    useCallback(() => {
      if (isAuthed) store.getState().startPolling();
      return () => store.getState().stopPolling();
    }, [isAuthed]),
  );

  if (!isAuthed) {
    return (
      <SafeAreaView className="flex-1 bg-offWhite items-center justify-center px-8">
        <Ionicons name="musical-notes" size={64} color={theme.gold} />
        <Text className="text-ink text-2xl font-bold mt-4">Connect Spotify</Text>
        <Text className="text-ink/50 text-center mt-2">
          Log in to control playback from your phone.
        </Text>
        <Pressable
          disabled={!isReady || !clientConfigured}
          onPress={() => promptAsync()}
          className="mt-8 bg-gold px-8 py-3 rounded-full active:opacity-80 disabled:opacity-40"
        >
          <Text className="text-accentInk font-semibold text-base">Log in with Spotify</Text>
        </Pressable>
        {!clientConfigured && (
          <Text className="text-danger text-xs mt-4 text-center">
            Set EXPO_PUBLIC_SPOTIFY_CLIENT_ID in .env first.
          </Text>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-offWhite">
      <View className="flex-row items-center justify-between px-6 pt-3 pb-1">
        <Text className="text-ink text-xl font-bold">Remote</Text>
        <ConnectionBadge />
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center' }}>
        <AlbumArt url={playback?.track?.albumArtUrl ?? null} />

        <Text className="text-ink text-2xl font-bold mt-6 text-center" numberOfLines={2}>
          {playback?.track?.name ?? 'Nothing playing'}
        </Text>
        <Text className="text-ink/60 text-base mt-1 text-center" numberOfLines={1}>
          {playback?.track?.artists.join(', ') ?? '—'}
        </Text>

        <ProgressBar
          progressMs={playback?.progressMs ?? 0}
          durationMs={playback?.track?.durationMs ?? 0}
          isPlaying={playback?.isPlaying ?? false}
          fetchedAt={playback?.fetchedAt ?? Date.now()}
        />

        <Controls isPlaying={playback?.isPlaying ?? false} />

        <TrackActions
          trackUri={playback?.track?.uri ?? null}
          trackName={playback?.track?.name ?? ''}
        />

        <VolumeSlider
          volume={playback?.volumePercent ?? 50}
          supported={playback?.supportsVolume ?? false}
        />

        <DevicePicker devices={devices} activeId={playback?.deviceId ?? null} />

        <SpeakerPower />

        {error ? <Text className="text-danger text-xs mt-6">{error}</Text> : null}
      </ScrollView>
      <AssistantFab />
    </SafeAreaView>
  );
}

function AlbumArt({ url }: { url: string | null }) {
  const theme = useThemeColors();
  return (
    <View className="w-64 h-64 rounded-2xl overflow-hidden bg-ink/10 border border-gold/30 items-center justify-center">
      {url ? (
        <Image source={{ uri: url }} className="w-full h-full" resizeMode="cover" />
      ) : (
        <Ionicons name="disc" size={96} color={theme.muted} />
      )}
    </View>
  );
}

function ProgressBar({
  progressMs,
  durationMs,
  isPlaying,
  fetchedAt,
}: {
  progressMs: number;
  durationMs: number;
  isPlaying: boolean;
  fetchedAt: number;
}) {
  // Interpolate between 5s polls for a smoother bar.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [isPlaying]);

  // While dragging, show the dragged position and pause interpolation so the
  // thumb doesn't fight the user. `dragging` is gated by onSlidingStart because
  // @react-native-community/slider fires onValueChange spuriously whenever the
  // `value` prop is updated programmatically (our 500ms interpolation) — without
  // that gate, dragMs latches and the bar freezes.
  const [dragMs, setDragMs] = useState<number | null>(null);
  const dragging = useRef(false);
  const theme = useThemeColors();

  const elapsed = isPlaying ? progressMs + (now - fetchedAt) : progressMs;
  const clamped = durationMs > 0 ? Math.min(elapsed, durationMs) : 0;
  const shown = dragMs ?? clamped;

  return (
    <View className="w-full mt-6">
      <Slider
        style={{ width: '100%', height: 32 }}
        minimumValue={0}
        maximumValue={Math.max(1, durationMs)}
        value={shown}
        disabled={durationMs <= 0}
        minimumTrackTintColor={theme.gold}
        maximumTrackTintColor={theme.track}
        thumbTintColor={theme.goldDark}
        onSlidingStart={() => {
          dragging.current = true;
        }}
        onValueChange={(v) => {
          if (dragging.current) setDragMs(v);
        }}
        onSlidingComplete={(v) => {
          dragging.current = false;
          setDragMs(null);
          void store.getState().seek(v);
        }}
      />
      <View className="flex-row justify-between -mt-1">
        <Text className="text-ink/40 text-xs">{fmt(shown)}</Text>
        <Text className="text-ink/40 text-xs">{fmt(durationMs)}</Text>
      </View>
    </View>
  );
}

function Controls({ isPlaying }: { isPlaying: boolean }) {
  const s = store.getState();
  const theme = useThemeColors();
  return (
    <View className="flex-row items-center justify-center mt-8 gap-6">
      {/* Restart current song (seek to 0) — separate from "previous track". */}
      <Pressable onPress={() => s.restart()} className="active:opacity-60 items-center">
        <Ionicons name="play-back" size={28} color={theme.muted} />
        <Text className="text-ink/40 text-[10px] mt-0.5">restart</Text>
      </Pressable>
      <Pressable onPress={() => s.previous()} className="active:opacity-60 items-center">
        <Ionicons name="play-skip-back" size={38} color={theme.ink} />
        <Text className="text-ink/40 text-[10px] mt-0.5">prev</Text>
      </Pressable>
      <Pressable
        onPress={() => (isPlaying ? s.pause() : s.play())}
        className="bg-gold w-20 h-20 rounded-full items-center justify-center active:opacity-80"
      >
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={40} color={theme.accentInk} />
      </Pressable>
      <Pressable onPress={() => s.next()} className="active:opacity-60 items-center">
        <Ionicons name="play-skip-forward" size={38} color={theme.ink} />
        <Text className="text-ink/40 text-[10px] mt-0.5">next</Text>
      </Pressable>
    </View>
  );
}

function TrackActions({ trackUri, trackName }: { trackUri: string | null; trackName: string }) {
  const theme = useThemeColors();
  const router = useRouter();
  const [picker, setPicker] = useState(false);
  const disabled = !trackUri;

  return (
    <View className="flex-row items-center justify-center gap-3 mt-6">
      <Pressable
        onPress={() => setPicker(true)}
        disabled={disabled}
        className="flex-row items-center rounded-full px-4 py-2 border border-line/10 active:opacity-70"
        style={{ opacity: disabled ? 0.4 : 1 }}
      >
        <Ionicons name="add" size={16} color={theme.goldDark} />
        <Text className="text-ink/80 text-xs font-semibold ml-1.5">Add to playlist</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push('/queue' as never)}
        className="flex-row items-center rounded-full px-4 py-2 border border-line/10 active:opacity-70"
      >
        <Ionicons name="list" size={16} color={theme.goldDark} />
        <Text className="text-ink/80 text-xs font-semibold ml-1.5">Queue</Text>
      </Pressable>

      <PlaylistPickerModal
        visible={picker}
        trackUri={trackUri}
        trackName={trackName}
        onClose={() => setPicker(false)}
      />
    </View>
  );
}

function VolumeSlider({ volume, supported }: { volume: number; supported: boolean }) {
  const hubReachable = useConnection((s) => s.reachable);
  const theme = useThemeColors();

  const usingHub = !supported && hubReachable;
  const enabled = supported || usingHub;

  const [hubVol, setHubVol] = useState<number | null>(null);
  // While dragging, show the dragged value and freeze polled updates so the
  // thumb doesn't snap back mid-gesture (mirrors the ProgressBar drag guard).
  const [dragVal, setDragVal] = useState<number | null>(null);
  const dragging = useRef(false);

  // Spotify won't take volume (e.g. a Bluetooth speaker) → control the tablet's
  // own media volume over the hub. Poll it so the slider tracks external changes.
  useEffect(() => {
    if (!usingHub) return;
    let alive = true;
    const fetchVol = () =>
      hubClient
        .getSystemVolume()
        .then((v) => {
          if (alive && !dragging.current) setHubVol(v);
        })
        .catch(() => {});
    void fetchVol();
    const t = setInterval(fetchVol, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [usingHub]);

  const serverValue = usingHub ? (hubVol ?? 0) : volume;
  const shown = dragVal ?? serverValue;

  const commit = (v: number): void => {
    const val = Math.round(v);
    if (usingHub) {
      setHubVol(val); // optimistic: avoid a flicker back to the old polled value
      void hubClient.setSystemVolume(val);
    } else {
      void store.getState().setVolume(val);
    }
  };

  return (
    <View className="w-full mt-10">
      <View className="flex-row items-center gap-3" style={{ opacity: enabled ? 1 : 0.4 }}>
        <Ionicons name="volume-low" size={20} color={theme.muted} />
        <Slider
          style={{ flex: 1, height: 40 }}
          minimumValue={0}
          maximumValue={100}
          value={shown}
          step={1}
          disabled={!enabled}
          tapToSeek
          minimumTrackTintColor={theme.gold}
          maximumTrackTintColor={theme.track}
          thumbTintColor={theme.goldDark}
          onSlidingStart={() => {
            dragging.current = true;
          }}
          onValueChange={(v) => {
            if (dragging.current) setDragVal(v);
          }}
          onSlidingComplete={(v) => {
            dragging.current = false;
            setDragVal(null);
            commit(v);
          }}
        />
        <Ionicons name="volume-high" size={20} color={theme.muted} />
        <Text className="text-ink/50 text-xs w-8 text-right">{Math.round(shown)}</Text>
      </View>
      {usingHub && (
        <Text className="text-ink/40 text-[11px] mt-1 text-center">
          Controlling the tablet/speaker volume via the hub (Spotify won't set it).
        </Text>
      )}
      {!supported && !hubReachable && (
        <Text className="text-ink/40 text-[11px] mt-1 text-center">
          This device doesn't allow remote volume — connect to the hub (Settings) to control the speaker.
        </Text>
      )}
    </View>
  );
}

function SpeakerPower() {
  const hubReachable = useConnection((s) => s.reachable);
  const theme = useThemeColors();
  const [busy, setBusy] = useState<null | 'wake' | 'sleep'>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const send = async (which: 'wake' | 'sleep') => {
    setBusy(which);
    setMsg(null);
    try {
      // BLE connect + GATT write can take ~10s; give it 15s before aborting so a
      // slow-but-successful wake doesn't surface as "Aborted".
      const res = await hubClient.sendCommand(
        { action: which === 'wake' ? 'speaker.wake' : 'speaker.sleep' },
        15_000,
      );
      const r = res.result as { ok?: boolean; error?: string } | undefined;
      if (r && r.ok === false) {
        setMsg(r.error ?? "Couldn't reach the speaker.");
      } else {
        setMsg(which === 'wake' ? 'Speaker powering on…' : 'Speaker powering off…');
      }
    } catch (e) {
      setMsg(`Couldn't reach the speaker: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="w-full mt-10" style={{ opacity: hubReachable ? 1 : 0.4 }}>
      <Text className="text-ink/40 text-xs uppercase tracking-wider mb-2">UE BOOM speaker</Text>
      <View className="flex-row gap-3">
        <Pressable
          disabled={!hubReachable || busy !== null}
          onPress={() => send('wake')}
          className="flex-1 flex-row items-center justify-center py-3 rounded-xl bg-gold active:opacity-80 disabled:opacity-50"
        >
          <Ionicons name="power" size={18} color={theme.accentInk} />
          <Text className="text-accentInk font-semibold ml-2">{busy === 'wake' ? 'Waking…' : 'Power on'}</Text>
        </Pressable>
        <Pressable
          disabled={!hubReachable || busy !== null}
          onPress={() => send('sleep')}
          className="flex-1 flex-row items-center justify-center py-3 rounded-xl bg-surface border border-line/10 active:opacity-70 disabled:opacity-50"
        >
          <Ionicons name="power" size={18} color={theme.muted} />
          <Text className="text-ink/70 font-semibold ml-2">{busy === 'sleep' ? 'Off…' : 'Power off'}</Text>
        </Pressable>
      </View>
      {msg && <Text className="text-ink/40 text-[11px] mt-1 text-center">{msg}</Text>}
      {!hubReachable && (
        <Text className="text-ink/40 text-[11px] mt-1 text-center">
          Connect to the hub (Settings) to power the speaker on/off.
        </Text>
      )}
    </View>
  );
}

function DevicePicker({
  devices,
  activeId,
}: {
  devices: { id: string; name: string; type: string; isActive: boolean }[];
  activeId: string | null;
}) {
  const theme = useThemeColors();
  if (devices.length === 0) return null;
  return (
    <View className="w-full mt-10">
      <Text className="text-ink/40 text-xs uppercase tracking-wider mb-2">Play on</Text>
      {devices.map((d) => {
        const active = d.isActive || d.id === activeId;
        return (
          <Pressable
            key={d.id}
            onPress={() => store.getState().transfer(d.id)}
            className={`flex-row items-center py-3 px-4 rounded-xl mb-2 ${
              active ? 'bg-gold/20 border border-gold' : 'bg-surface border border-line/5'
            }`}
          >
            <Ionicons
              name={d.type === 'Computer' ? 'laptop' : 'volume-medium'}
              size={20}
              color={active ? theme.goldDark : theme.muted}
            />
            <Text className="text-ink ml-3 flex-1">{d.name}</Text>
            {active && <Ionicons name="checkmark-circle" size={20} color={theme.goldDark} />}
          </Pressable>
        );
      })}
    </View>
  );
}
