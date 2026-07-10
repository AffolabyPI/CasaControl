/**
 * Phone-side music search/play helpers.
 *
 * Search + playlist reads go straight to Spotify (the phone holds the token).
 * PLAY / QUEUE are routed through the hub so the tablet can foreground its own
 * Spotify and start playback on its Connect device — the only reliable way to
 * start music when nothing is currently active.
 */
import type { SpotifySearchResults, SpotifyPlaylist, SpotifyTrack } from '@casacontrol/shared';
import { spotifyClient } from './spotify';
import { hubClient } from './connection';

export function searchMusic(query: string): Promise<SpotifySearchResults> {
  return spotifyClient.search(query);
}

export function getMyPlaylists(): Promise<SpotifyPlaylist[]> {
  return spotifyClient.getMyPlaylists();
}

/** The current play queue (now-playing + upcoming) straight from Spotify. */
export function getQueue(): Promise<{ current: SpotifyTrack | null; upcoming: SpotifyTrack[] }> {
  return spotifyClient.getQueue();
}

/**
 * Toggle a track in a playlist: remove it if already there, else add it.
 * Returns which happened so the UI can flash the right message.
 */
export async function toggleTrackInPlaylist(
  playlistId: string,
  uri: string,
): Promise<'added' | 'removed'> {
  const tracks = await spotifyClient.getPlaylistTracks(playlistId, 100);
  if (tracks.some((t) => t.uri === uri)) {
    await spotifyClient.removeFromPlaylist(playlistId, uri);
    return 'removed';
  }
  await spotifyClient.addToPlaylist(playlistId, uri);
  return 'added';
}

/**
 * Play a playlist blended with recommended songs, interleaved from the start
 * (2 playlist tracks : 1 suggestion). Falls back to plain playback if Spotify
 * returns no recommendations (e.g. the endpoint isn't available for this app).
 */
export async function playPlaylistBlended(playlistUri: string): Promise<boolean> {
  const id = playlistUri.split(':').pop() ?? '';

  // Build the interleaved list. ANY Spotify hiccup here (e.g. the recommendations
  // endpoint is restricted for this app, or a playlist can't be read) must not
  // surface a raw error — we just fall back to playing the playlist normally.
  let blended: string[] | null = null;
  try {
    const tracks = await spotifyClient.getPlaylistTracks(id, 50);
    if (tracks.length > 0) {
      const recs = (
        await spotifyClient.getRecommendations(tracks.slice(0, 5).map((t) => t.id), 25)
      ).filter((t): t is SpotifyTrack & { uri: string } => !!t.uri);
      if (recs.length > 0) {
        const list: string[] = [];
        let ri = 0;
        tracks.forEach((t, i) => {
          list.push(t.uri);
          const rec = i % 2 === 1 ? recs[ri] : undefined;
          if (rec) {
            list.push(rec.uri);
            ri++;
          }
        });
        for (; ri < recs.length; ri++) {
          const rec = recs[ri];
          if (rec) list.push(rec.uri);
        }
        blended = list;
      }
    }
  } catch {
    blended = null;
  }

  // No suggestions available → plain playlist. Return false so the caller can
  // tell the user suggestions weren't added.
  if (!blended) {
    await playUri(playlistUri);
    return false;
  }

  const res = await hubClient.sendCommand({ action: 'spotify.playUris', uris: blended });
  const r = res.result as { ok?: boolean; error?: string } | undefined;
  if (r && r.ok === false) throw new Error(r.error ?? 'Could not start playback');
  return true;
}

/** Start a track/playlist/album URI on the tablet (via the hub). */
export async function playUri(uri: string): Promise<void> {
  const res = await hubClient.sendCommand({ action: 'spotify.playContext', uri });
  const r = res.result as { ok?: boolean; error?: string } | undefined;
  if (r && r.ok === false) throw new Error(r.error ?? 'Could not start playback');
}

/** Add a track URI to the queue (via the hub). */
export async function queueUri(uri: string): Promise<void> {
  const res = await hubClient.sendCommand({ action: 'spotify.queue', uri });
  const r = res.result as { ok?: boolean; error?: string } | undefined;
  if (r && r.ok === false) throw new Error(r.error ?? 'Could not queue track');
}
