/**
 * Tablet-side Spotify playback control that can start music FROM NOTHING.
 *
 * The core problem: Spotify's Web API can only START playback on a device that
 * is "available" (listed in /me/player/devices), and the tablet only appears
 * there while its Spotify app is running. When nothing is playing the tablet is
 * often absent, so `play` 404s and there's no device to pick.
 *
 * Fix: if no usable device is found we foreground the Spotify app on the tablet
 * (via a `spotify:` deep link), which registers it as a Connect device, then
 * start playback on it with an explicit `device_id`.
 */
import * as Linking from 'expo-linking';
import { createLogger, type SpotifyDevice, type SpotifySearchResults } from '@casacontrol/shared';
import { spotifyClient, store as spotify } from './spotify';

const log = createLogger('spotify-ctl');
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Optionally pin playback to a specific Spotify Connect device by name.
const PREFERRED_DEVICE = process.env.EXPO_PUBLIC_SPOTIFY_DEVICE_NAME ?? '';

/** Prefer a configured device, then the active one, then a tablet/computer. */
function pickDevice(devices: SpotifyDevice[]): SpotifyDevice | null {
  return (
    (PREFERRED_DEVICE
      ? devices.find((d) => d.name.toLowerCase() === PREFERRED_DEVICE.toLowerCase())
      : undefined) ??
    devices.find((d) => d.isActive) ??
    devices.find((d) => /tablet|computer/i.test(d.type)) ??
    devices[0] ??
    null
  );
}

/** Find a device to play on, foregrounding Spotify on the tablet if needed. */
async function ensureDevice(): Promise<{ target: SpotifyDevice | null; devices: SpotifyDevice[] }> {
  let devices = await spotifyClient.getDevices();
  let target = pickDevice(devices);
  if (!target) {
    log.info('no Spotify device available — foregrounding Spotify on the tablet');
    await Linking.openURL('spotify:').catch((e) => log.warn('open spotify: failed', String(e)));
    await delay(3500);
    devices = await spotifyClient.getDevices();
    target = pickDevice(devices);
    log.info(`after foreground: ${devices.length} device(s), target=${target?.name ?? 'none'}`);
  }
  return { target, devices };
}

/** Start playback of a track/album/playlist URI on the tablet. */
export async function playContext(
  uri: string,
): Promise<{ ok: boolean; device?: string; error?: string }> {
  const { target } = await ensureDevice();
  if (!target) {
    return { ok: false, error: 'No Spotify device available — open Spotify on the tablet once.' };
  }
  const isTrack = uri.includes(':track:');
  await spotifyClient.startPlayback(
    isTrack ? { uris: [uri], deviceId: target.id } : { contextUri: uri, deviceId: target.id },
  );
  await delay(700);
  await spotify.getState().refresh();
  log.info(`started ${uri} on ${target.name}`);
  return { ok: true, device: target.name };
}

/** Queue a track URI (starts playback first if nothing is active). */
export async function queueTrack(
  uri: string,
): Promise<{ ok: boolean; device?: string; error?: string }> {
  const { target } = await ensureDevice();
  if (!target) {
    return { ok: false, error: 'No Spotify device available — open Spotify on the tablet once.' };
  }
  try {
    await spotifyClient.addToQueue(uri, target.id);
  } catch (e) {
    // Queue needs active playback; if there's none, just start this track.
    log.warn(`queue failed, starting instead: ${String(e)}`);
    await spotifyClient.startPlayback({ uris: [uri], deviceId: target.id });
  }
  await delay(500);
  await spotify.getState().refresh();
  return { ok: true, device: target.name };
}

/** Search (used by the hub test route; the phone searches directly). */
export function searchSpotify(query: string): Promise<SpotifySearchResults> {
  return spotifyClient.search(query);
}

/** Current device list (hub test route). */
export function listDevices(): Promise<SpotifyDevice[]> {
  return spotifyClient.getDevices();
}
