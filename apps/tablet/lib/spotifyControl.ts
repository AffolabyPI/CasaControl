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
import {
  playUri as remotePlayUri,
  resumeSpotify,
  connectSpotify,
  isSpotifyConnected,
} from '../modules/spotify-remote';

const log = createLogger('spotify-ctl');
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Optionally pin playback to a specific Spotify Connect device by name.
const PREFERRED_DEVICE = process.env.EXPO_PUBLIC_SPOTIFY_DEVICE_NAME ?? '';

// App Remote drives the tablet's *local* Spotify app directly — the only path
// that can start playback from cold while the tablet is off/locked. Needs the
// tablet's package + signing SHA1 + this redirect URI registered in the Spotify
// dashboard, and a one-time authorization (done while unlocked).
const SPOTIFY_CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';
const SPOTIFY_REDIRECT_URI =
  process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI ?? 'casacontrol-hub://spotify-callback';

/** Start playback on the local Spotify via App Remote. Returns false if it can't. */
async function tryAppRemotePlay(uri: string): Promise<boolean> {
  if (!SPOTIFY_CLIENT_ID) return false;
  try {
    await remotePlayUri(SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, uri);
    return true;
  } catch (e) {
    log.warn(`App Remote play failed: ${String(e)}`);
    return false;
  }
}

/** Start a track/album/playlist/artist URI on a Web-API device. */
async function startOn(uri: string, deviceId: string): Promise<void> {
  const isTrack = uri.includes(':track:');
  await spotifyClient.startPlayback(
    isTrack ? { uris: [uri], deviceId } : { contextUri: uri, deviceId },
  );
}

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
  // If a device is already registered, use the Web API — it respects the active
  // device (e.g. the PS5) and doesn't yank playback onto the tablet.
  const devices = await spotifyClient.getDevices();
  const target = pickDevice(devices);
  if (target) {
    try {
      await startOn(uri, target.id);
      await delay(700);
      await spotify.getState().refresh();
      log.info(`started ${uri} on ${target.name}`);
      return { ok: true, device: target.name };
    } catch (e) {
      // The device was listed but couldn't be started (e.g. a registered-but-idle
      // tablet the Web API can't wake over a lock screen). Fall through to App
      // Remote, which drives the local Spotify directly.
      log.warn(`Web API start on ${target.name} failed — falling back to App Remote: ${String(e)}`);
    }
  }

  // No usable Web-API device (cold, or the start above failed). Drive the
  // tablet's local Spotify directly via App Remote — the deep-link foreground
  // below can't run over a secure lock screen, but App Remote can once authorized.
  if (!PREFERRED_DEVICE && (await tryAppRemotePlay(uri))) {
    await delay(900);
    await spotify.getState().refresh();
    log.info(`started ${uri} via App Remote (local Spotify)`);
    return { ok: true, device: 'Tablet' };
  }

  // Last resort (unlocked only): foreground Spotify to register it, then retry.
  const { target: t2 } = await ensureDevice();
  if (!t2) {
    return {
      ok: false,
      error: 'No Spotify device available — open Spotify on the tablet once, and authorize App Remote.',
    };
  }
  await startOn(uri, t2.id);
  await delay(700);
  await spotify.getState().refresh();
  log.info(`started ${uri} on ${t2.name}`);
  return { ok: true, device: t2.name };
}

/**
 * Resume playback on the tablet's LOCAL Spotify via App Remote. This is the
 * cold-start path for the phone's bare play button: when Spotify's Web API has
 * no available device (tablet locked/idle), the phone asks the hub to run this,
 * which drives the local Spotify app directly — working even behind a lock
 * screen once App Remote has been authorized once.
 */
export async function resumeLocal(): Promise<{ ok: boolean; error?: string }> {
  if (!SPOTIFY_CLIENT_ID) return { ok: false, error: 'No Spotify client ID configured' };
  try {
    if (!isSpotifyConnected()) {
      await connectSpotify(SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI);
    }
    await resumeSpotify();
    await delay(900);
    await spotify.getState().refresh();
    log.info('resumed local Spotify via App Remote');
    return { ok: true };
  } catch (e) {
    log.warn(`resumeLocal failed: ${String(e)}`);
    return { ok: false, error: String(e) };
  }
}

/**
 * Start an explicit ordered list of track URIs (used to blend a playlist with
 * recommended songs). Cold-starts the tablet with the first track via App Remote
 * so it registers as a Connect device, then hands the full list to the Web API.
 */
export async function playUris(
  uris: string[],
): Promise<{ ok: boolean; device?: string; error?: string }> {
  if (!uris.length) return { ok: false, error: 'No tracks to play' };
  const first = uris[0]!;

  let devices = await spotifyClient.getDevices();
  let target = pickDevice(devices);

  if (!target && !PREFERRED_DEVICE && (await tryAppRemotePlay(first))) {
    // App Remote woke the local Spotify — give it a moment to register, then the
    // Web API can take over with the whole blended list.
    await delay(1500);
    devices = await spotifyClient.getDevices();
    target = pickDevice(devices);
  }
  if (!target) {
    ({ target } = await ensureDevice());
  }
  if (!target) {
    return {
      ok: false,
      error: 'No Spotify device available — open Spotify on the tablet once, and authorize App Remote.',
    };
  }

  try {
    // Spotify's start endpoint takes up to 100 URIs.
    await spotifyClient.startPlayback({ uris: uris.slice(0, 100), deviceId: target.id });
    await delay(700);
    await spotify.getState().refresh();
    log.info(`started ${uris.length} blended tracks on ${target.name}`);
    return { ok: true, device: target.name };
  } catch (e) {
    log.warn(`playUris failed: ${String(e)}`);
    return { ok: false, error: String(e) };
  }
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

/**
 * Force an App Remote connection. Run this once while the tablet is UNLOCKED to
 * trigger Spotify's one-time authorization prompt; after that, connect/play is
 * silent even while locked.
 */
export async function connectRemote(): Promise<{ connected: boolean; error?: string }> {
  if (!SPOTIFY_CLIENT_ID) return { connected: false, error: 'No Spotify client ID configured' };
  // Foreground the Spotify app first so it has a visible window: the first-time
  // SSO authorization screen is launched *by Spotify's process*, and Android's
  // background-activity-launch rules block that unless Spotify is already visible.
  // Only needed for this one-time auth — later connects are silent (no UI).
  await Linking.openURL('spotify:').catch((e) => log.warn('open spotify: failed', String(e)));
  await delay(2500);
  try {
    await connectSpotify(SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI);
    return { connected: isSpotifyConnected() };
  } catch (e) {
    return { connected: false, error: String(e) };
  }
}

/** Search (used by the hub test route; the phone searches directly). */
export function searchSpotify(query: string): Promise<SpotifySearchResults> {
  return spotifyClient.search(query);
}

/** Current device list (hub test route). */
export function listDevices(): Promise<SpotifyDevice[]> {
  return spotifyClient.getDevices();
}
