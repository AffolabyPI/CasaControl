/**
 * Bottom-sheet playlist picker. Tapping a playlist toggles the given track in
 * it (adds if absent, removes if present). Used from the Remote now-playing and
 * the queue to add/remove the current song to/from a playlist.
 */
import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SpotifyPlaylist } from '@casacontrol/shared';
import { getMyPlaylists, toggleTrackInPlaylist } from '../lib/music';
import { useThemeColors } from '../lib/theme';

export function PlaylistPickerModal({
  visible,
  trackUri,
  trackName,
  onClose,
}: {
  visible: boolean;
  trackUri: string | null;
  trackName: string;
  onClose: () => void;
}) {
  const theme = useThemeColors();
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setMsg(null);
    getMyPlaylists()
      .then(setPlaylists)
      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [visible]);

  const onPick = async (p: SpotifyPlaylist): Promise<void> => {
    if (!trackUri) return;
    setBusyId(p.id);
    setMsg(null);
    try {
      const result = await toggleTrackInPlaylist(p.id, trackUri);
      setMsg(result === 'added' ? `Added to ${p.name}` : `Removed from ${p.name}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't update that playlist");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50" onPress={onClose} />
      <View className="absolute bottom-0 left-0 right-0 bg-offWhite rounded-t-3xl max-h-[70%] pb-8">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 rounded-full bg-ink/20" />
        </View>
        <Text className="text-ink text-lg font-bold px-6 mb-1">Add to playlist</Text>
        <Text className="text-ink/50 text-xs px-6 mb-3" numberOfLines={1}>
          {trackName}
        </Text>
        {msg ? <Text className="text-goldDark text-xs px-6 mb-2">{msg}</Text> : null}
        {loading ? (
          <ActivityIndicator color={theme.gold} className="my-8" />
        ) : (
          <FlatList
            data={playlists}
            keyExtractor={(p) => p.id}
            ListEmptyComponent={
              <Text className="text-ink/40 text-center mt-8 px-6">
                No playlists — reconnect Spotify in Search to grant playlist access.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => void onPick(item)}
                className="flex-row items-center px-6 py-3 active:opacity-60"
              >
                <Ionicons name="list" size={20} color={theme.goldDark} />
                <Text className="text-ink ml-3 flex-1" numberOfLines={1}>
                  {item.name}
                </Text>
                {busyId === item.id ? (
                  <ActivityIndicator size="small" color={theme.gold} />
                ) : (
                  <Ionicons name="add" size={20} color={theme.muted} />
                )}
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}
