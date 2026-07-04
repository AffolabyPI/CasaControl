/**
 * Phone-side music search/play helpers.
 *
 * Search + playlist reads go straight to Spotify (the phone holds the token).
 * PLAY / QUEUE are routed through the hub so the tablet can foreground its own
 * Spotify and start playback on its Connect device — the only reliable way to
 * start music when nothing is currently active.
 */
import type { SpotifySearchResults, SpotifyPlaylist } from '@casacontrol/shared';
import { spotifyClient } from './spotify';
import { hubClient } from './connection';

export function searchMusic(query: string): Promise<SpotifySearchResults> {
  return spotifyClient.search(query);
}

export function getMyPlaylists(): Promise<SpotifyPlaylist[]> {
  return spotifyClient.getMyPlaylists();
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
