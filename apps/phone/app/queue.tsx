/**
 * Full play-queue view: the track playing now plus everything coming up, read
 * live from Spotify. Each upcoming track can be added to a playlist.
 */
import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type { SpotifyTrack } from '@casacontrol/shared';
import { getQueue } from '../lib/music';
import { useThemeColors } from '../lib/theme';
import { PlaylistPickerModal } from '../components/PlaylistPickerModal';

export default function Queue() {
  const theme = useThemeColors();
  const router = useRouter();
  const [current, setCurrent] = useState<SpotifyTrack | null>(null);
  const [upcoming, setUpcoming] = useState<SpotifyTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<SpotifyTrack | null>(null);

  const load = useCallback(() => {
    setError(null);
    getQueue()
      .then(({ current: c, upcoming: u }) => {
        setCurrent(c);
        setUpcoming(u);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const t = setInterval(load, 5000);
      return () => clearInterval(t);
    }, [load]),
  );

  return (
    <SafeAreaView className="flex-1 bg-offWhite">
      <View className="flex-row items-center px-4 pt-3 pb-2">
        <Pressable onPress={() => router.back()} className="p-2 active:opacity-60">
          <Ionicons name="chevron-back" size={24} color={theme.ink} />
        </Pressable>
        <Text className="text-ink text-xl font-bold ml-1">Queue</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.gold} className="mt-10" />
      ) : (
        <FlatList
          data={upcoming}
          keyExtractor={(t, i) => `${t.id}-${i}`}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ListHeaderComponent={
            <View>
              {error ? <Text className="text-danger text-xs mb-3">{error}</Text> : null}
              {current ? (
                <View className="mb-4">
                  <Text className="text-ink/40 text-xs uppercase tracking-wider mb-2">Now playing</Text>
                  <QueueRow track={current} highlight onAdd={setPicker} />
                </View>
              ) : null}
              <Text className="text-ink/40 text-xs uppercase tracking-wider mb-2">Up next</Text>
            </View>
          }
          renderItem={({ item }) => <QueueRow track={item} onAdd={setPicker} />}
          ListEmptyComponent={
            <Text className="text-ink/40 text-center mt-8">
              Nothing queued. Add songs from Search or a playlist.
            </Text>
          }
        />
      )}

      <PlaylistPickerModal
        visible={picker !== null}
        trackUri={picker?.uri ?? null}
        trackName={picker?.name ?? ''}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  );
}

function QueueRow({
  track,
  highlight,
  onAdd,
}: {
  track: SpotifyTrack;
  highlight?: boolean;
  onAdd: (t: SpotifyTrack) => void;
}) {
  const theme = useThemeColors();
  return (
    <View
      className={`flex-row items-center rounded-xl px-3 py-2 mb-2 ${
        highlight ? 'bg-gold/15 border border-gold/40' : 'bg-surface border border-line/5'
      }`}
    >
      <View className="w-11 h-11 rounded-lg overflow-hidden bg-ink/10 items-center justify-center">
        {track.albumArtUrl ? (
          <Image source={{ uri: track.albumArtUrl }} className="w-full h-full" resizeMode="cover" />
        ) : (
          <Ionicons name="musical-note" size={20} color={theme.muted} />
        )}
      </View>
      <View className="flex-1 ml-3 mr-2">
        <Text className="text-ink font-medium" numberOfLines={1}>
          {track.name}
        </Text>
        <Text className="text-ink/50 text-xs" numberOfLines={1}>
          {track.artists.join(', ')}
        </Text>
      </View>
      {track.uri ? (
        <Pressable onPress={() => onAdd(track)} className="p-2 active:opacity-50" hitSlop={8}>
          <Ionicons name="add-circle-outline" size={22} color={theme.goldDark} />
        </Pressable>
      ) : null}
    </View>
  );
}
