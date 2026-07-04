import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import {
  COLORS,
  type SpotifyTrack,
  type SpotifyPlaylist,
  type SpotifySearchResults,
} from '@casacontrol/shared';
import { searchMusic, getMyPlaylists, playUri, queueUri } from '../../lib/music';
import { useSpotifyLogin, logoutSpotify } from '../../lib/spotify';

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotifySearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { promptAsync } = useSpotifyLogin();

  const reconnect = async () => {
    await logoutSpotify();
    await promptAsync();
  };

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      searchMusic(q)
        .then(setResults)
        .catch((e) => setToast(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  // Load the user's playlists when the tab is focused.
  useFocusEffect(
    useCallback(() => {
      getMyPlaylists()
        .then((p) => {
          setPlaylists(p);
          setPlaylistsError(null);
        })
        .catch((e) => setPlaylistsError(e instanceof Error ? e.message : String(e)));
    }, []),
  );

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 2500);
  };

  const play = async (uri: string, label: string) => {
    flash(`Starting ${label}…`);
    try {
      await playUri(uri);
      flash(`Playing ${label}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  };

  const queue = async (uri: string, label: string) => {
    try {
      await queueUri(uri);
      flash(`Queued ${label}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  };

  const showingSearch = query.trim().length > 0;

  return (
    <SafeAreaView className="flex-1 bg-offWhite">
      <View className="px-6 pt-3 pb-2">
        <Text className="text-ink text-xl font-bold mb-3">Search</Text>
        <View className="flex-row items-center bg-white rounded-full px-4 border border-black/5">
          <Ionicons name="search" size={18} color={COLORS.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Songs, artists, playlists…"
            placeholderTextColor={COLORS.muted}
            autoCorrect={false}
            className="flex-1 py-3 px-2 text-ink"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} className="p-1">
              <Ionicons name="close-circle" size={18} color={COLORS.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 8 }} keyboardShouldPersistTaps="handled">
        {showingSearch ? (
          <>
            {busy && <ActivityIndicator color={COLORS.gold} className="my-4" />}
            {results && results.tracks.length > 0 && (
              <Section title="Songs">
                {results.tracks.map((t) => (
                  <TrackRow key={t.id} track={t} onPlay={play} onQueue={queue} />
                ))}
              </Section>
            )}
            {results && results.contexts.length > 0 && (
              <Section title="Playlists & Albums">
                {results.contexts.map((c) => (
                  <ContextRow key={c.id} item={c} onPlay={play} />
                ))}
              </Section>
            )}
            {results && !busy && results.tracks.length === 0 && results.contexts.length === 0 && (
              <Text className="text-ink/40 text-center mt-8">No results.</Text>
            )}
          </>
        ) : (
          <Section title="Your Playlists">
            {playlistsError ? (
              <View className="bg-white rounded-xl p-4 border border-black/5">
                <Text className="text-ink/60 text-sm mb-1">Couldn't load your playlists.</Text>
                <Text className="text-ink/40 text-xs mb-3">
                  Grant playlist access by reconnecting Spotify (search &amp; play still work
                  without it).
                </Text>
                <Pressable
                  onPress={reconnect}
                  className="self-start bg-gold rounded-full px-4 py-2 active:opacity-80"
                >
                  <Text className="text-ink font-semibold text-sm">Reconnect Spotify</Text>
                </Pressable>
              </View>
            ) : playlists.length === 0 ? (
              <ActivityIndicator color={COLORS.gold} className="my-4" />
            ) : (
              playlists.map((p) => <ContextRow key={p.id} item={p} onPlay={play} />)
            )}
          </Section>
        )}
      </ScrollView>

      {toast && (
        <View className="absolute bottom-6 self-center bg-ink/90 rounded-full px-5 py-2.5 max-w-[90%]">
          <Text className="text-white text-sm text-center" numberOfLines={2}>
            {toast}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="text-ink/40 text-xs uppercase tracking-wider mb-2">{title}</Text>
      {children}
    </View>
  );
}

function Thumb({ url, icon }: { url: string | null; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View className="w-12 h-12 rounded-lg overflow-hidden bg-ink/10 items-center justify-center">
      {url ? (
        <Image source={{ uri: url }} className="w-full h-full" resizeMode="cover" />
      ) : (
        <Ionicons name={icon} size={22} color={COLORS.muted} />
      )}
    </View>
  );
}

function TrackRow({
  track,
  onPlay,
  onQueue,
}: {
  track: SpotifyTrack;
  onPlay: (uri: string, label: string) => void;
  onQueue: (uri: string, label: string) => void;
}) {
  return (
    <View className="flex-row items-center py-2">
      <Pressable
        onPress={() => track.uri && onPlay(track.uri, track.name)}
        className="flex-row items-center flex-1 active:opacity-60"
      >
        <Thumb url={track.albumArtUrl} icon="musical-note" />
        <View className="flex-1 ml-3 mr-2">
          <Text className="text-ink font-medium" numberOfLines={1}>
            {track.name}
          </Text>
          <Text className="text-ink/50 text-xs" numberOfLines={1}>
            {track.artists.join(', ')}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => track.uri && onQueue(track.uri, track.name)}
        className="p-2 active:opacity-50"
        hitSlop={8}
      >
        <Ionicons name="add-circle-outline" size={24} color={COLORS.goldDark} />
      </Pressable>
    </View>
  );
}

function ContextRow({
  item,
  onPlay,
}: {
  item: SpotifyPlaylist;
  onPlay: (uri: string, label: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPlay(item.uri, item.name)}
      className="flex-row items-center py-2 active:opacity-60"
    >
      <Thumb url={item.imageUrl} icon={item.kind === 'album' ? 'disc' : 'list'} />
      <View className="flex-1 ml-3">
        <Text className="text-ink font-medium" numberOfLines={1}>
          {item.name}
        </Text>
        <Text className="text-ink/50 text-xs" numberOfLines={1}>
          {item.subtitle}
        </Text>
      </View>
      <Ionicons name="play-circle" size={26} color={COLORS.gold} />
    </Pressable>
  );
}
