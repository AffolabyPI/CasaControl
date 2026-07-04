import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@casacontrol/shared';
import { store, useSpotifyStore } from '../lib/spotify';

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Large "Now Playing" panel for the tablet hub (Phase 2 + reused in Phase 6).
 * Big album art, track/artist, seekable progress bar, transport controls.
 */
export function NowPlaying() {
  const playback = useSpotifyStore((s) => s.playback);
  const isPlaying = playback?.isPlaying ?? false;
  const track = playback?.track ?? null;

  const [now, setNow] = useState(Date.now());
  const [dragMs, setDragMs] = useState<number | null>(null);
  useEffect(() => {
    if (!isPlaying) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [isPlaying]);

  const elapsed = isPlaying
    ? (playback?.progressMs ?? 0) + (now - (playback?.fetchedAt ?? now))
    : (playback?.progressMs ?? 0);
  const duration = track?.durationMs ?? 0;
  const shown = dragMs ?? (duration > 0 ? Math.min(elapsed, duration) : 0);

  return (
    <View className="flex-row items-center gap-8">
      <View className="w-52 h-52 rounded-2xl overflow-hidden bg-ink-soft border border-gold/30 items-center justify-center">
        {track?.albumArtUrl ? (
          <Image
            source={{ uri: track.albumArtUrl }}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <Ionicons name="disc" size={80} color={COLORS.muted} />
        )}
      </View>

      <View className="flex-1">
        <Text className="text-gold text-xs uppercase tracking-[3px]">Now Playing</Text>
        <Text className="text-white text-3xl font-bold mt-2" numberOfLines={2}>
          {track?.name ?? 'Nothing playing'}
        </Text>
        <Text className="text-white/60 text-lg mt-1" numberOfLines={1}>
          {track?.artists.join(', ') ?? '—'}
        </Text>

        <Slider
          style={{ width: '100%', height: 32, marginTop: 12 }}
          minimumValue={0}
          maximumValue={Math.max(1, duration)}
          value={shown}
          disabled={duration <= 0}
          minimumTrackTintColor={COLORS.gold}
          maximumTrackTintColor="#ffffff22"
          thumbTintColor={COLORS.gold}
          onValueChange={(v) => setDragMs(v)}
          onSlidingComplete={(v) => {
            setDragMs(null);
            void store.getState().seek(v);
          }}
        />
        <View className="flex-row justify-between -mt-1">
          <Text className="text-white/40 text-xs">{fmt(shown)}</Text>
          <Text className="text-white/40 text-xs">{fmt(duration)}</Text>
        </View>

        <View className="flex-row items-center gap-8 mt-5">
          {/* Restart current song — distinct from "previous track". */}
          <Pressable onPress={() => store.getState().restart()} className="active:opacity-60">
            <Ionicons name="play-back" size={30} color={COLORS.muted} />
          </Pressable>
          <Pressable onPress={() => store.getState().previous()} className="active:opacity-60">
            <Ionicons name="play-skip-back" size={34} color={COLORS.white} />
          </Pressable>
          <Pressable
            onPress={() => (isPlaying ? store.getState().pause() : store.getState().play())}
            className="bg-gold w-16 h-16 rounded-full items-center justify-center active:opacity-80"
          >
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={32} color={COLORS.ink} />
          </Pressable>
          <Pressable onPress={() => store.getState().next()} className="active:opacity-60">
            <Ionicons name="play-skip-forward" size={34} color={COLORS.white} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
