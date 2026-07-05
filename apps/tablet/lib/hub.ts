/**
 * Ties the hub together: starts device discovery + the HTTP server, and routes
 * CasaActions coming from the phone (or the Claude assistant) to the right
 * subsystem. Phase 4 extends the PS5/printer branches.
 */
import * as Network from 'expo-network';
import Constants from 'expo-constants';
import { HUB_SERVER_PORT, createLogger, type CasaAction } from '@casacontrol/shared';
import { HubServer } from './server/hubServer';
import { deviceStore } from './discovery/store';
import { store as spotify } from './spotify';
import { ps5Status, ps5Wake, printerStatus } from './devices/controllers';
import { startHubForegroundService, stopHubForegroundService } from './foregroundService';
import { hubModeStore } from './hubMode';
import { isSpotifyConnected } from '../modules/spotify-remote';
import {
  listProfiles,
  saveProfile,
  executeProfile,
  deleteProfile,
} from './devices/deviceProfiles';
import type { DeviceProfile } from '@casacontrol/shared';
import { getSystemVolumePercent, setSystemVolumePercent } from './systemVolume';
import { discoverSpeaker, wakeUeBoom, sleepUeBoom, wakeSpeaker } from './bleSpeaker';
import {
  playContext,
  queueTrack,
  searchSpotify,
  listDevices,
  connectRemote,
} from './spotifyControl';

const log = createLogger('hub');
let server: HubServer | null = null;

export async function runCommand(action: CasaAction): Promise<unknown> {
  const s = spotify.getState();
  switch (action.action) {
    case 'spotify.play':
      await s.play();
      return { ok: true };
    case 'spotify.pause':
      await s.pause();
      return { ok: true };
    case 'spotify.next':
      await s.next();
      return { ok: true };
    case 'spotify.previous':
      await s.previous();
      return { ok: true };
    case 'spotify.setVolume':
      await s.setVolume(action.volume);
      return { ok: true };
    case 'spotify.transfer':
      await s.transfer(action.deviceId);
      return { ok: true };
    case 'spotify.playContext':
      return playContext(action.uri);
    case 'spotify.queue':
      return queueTrack(action.uri);
    case 'system.setVolume':
      await setSystemVolumePercent(action.volume);
      return { ok: true, volume: action.volume };
    case 'speaker.wake':
      await wakeUeBoom();
      return { ok: true };
    case 'speaker.sleep':
      await sleepUeBoom();
      return { ok: true };
    case 'devices.list':
      return deviceStore
        .getState()
        .devices.filter((d) => !action.category || d.category === action.category);
    case 'ps5.wake':
      return ps5Wake();
    case 'ps5.status':
      return ps5Status();
    case 'printer.print':
      // Printing is initiated from the phone (it holds the picked file);
      // the hub just reports current printer status here.
      return { ok: false, error: 'Start prints from the phone', status: await printerStatus() };
    default:
      return { ok: false, error: `Unhandled action: ${action.action}` };
  }
}

export function startHub(): void {
  // Keep the process alive when the tablet is idle so the hub stays reachable.
  void startHubForegroundService();
  deviceStore.getState().start();
  if (server) return;
  server = new HubServer({
    getHealth: async () => ({
      version: (Constants.expoConfig?.version as string | undefined) ?? '0.0.0',
      hubMode: hubModeStore.getState().mode,
      deviceCount: deviceStore.getState().devices.length,
      spotifyConnected: isSpotifyConnected(),
    }),
    getDevices: async () => deviceStore.getState().devices,
    getPlayback: async () => spotify.getState().playback,
    getPs5Status: ps5Status,
    getPrinterStatus: printerStatus,
    getSystemVolume: getSystemVolumePercent,
    bleDiscover: discoverSpeaker,
    bleWrite: (id, svc, chr, val, resp) => wakeSpeaker(id, svc, chr, val, resp),
    spotifyDevices: listDevices,
    spotifySearch: searchSpotify,
    spotifyStart: playContext,
    spotifyRemoteConnect: connectRemote,
    profilesList: listProfiles,
    profileSave: async (body) => {
      try {
        await saveProfile(body as DeviceProfile); // saveProfile validates via zod
        return { ok: true };
      } catch (e) {
        // Defense-in-depth: a profile that fails schema validation is rejected
        // here too, returned as a clean error rather than a 500.
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    profileExecute: async (body) => {
      const b = body as {
        profileId?: string;
        actionName?: string;
        target?: { targetMac?: string; targetIp?: string; bleDeviceId?: string };
      };
      if (!b.profileId || !b.actionName) return { ok: false, error: 'need profileId + actionName' };
      return executeProfile(b.profileId, b.actionName, b.target ?? {});
    },
    profileDelete: async (body) => {
      const id = (body as { profileId?: string }).profileId;
      if (!id) return { ok: false, error: 'need profileId' };
      await deleteProfile(id);
      return { ok: true };
    },
    runCommand,
  });
  server.start(HUB_SERVER_PORT);

  // Log the tablet's own LAN IP so you know exactly what to enter as the hub
  // "Local WiFi IP" on the phone (the hub runs HERE, on the tablet — not on
  // the dev machine).
  void Network.getIpAddressAsync()
    .then((ip) =>
      log.info(
        `hub server listening on http://${ip}:${HUB_SERVER_PORT} — ` +
          `enter ${ip} as the phone's Local WiFi IP`,
      ),
    )
    .catch((e) => log.warn('could not read tablet IP', String(e)));
}

export function stopHub(): void {
  deviceStore.getState().stop();
  server?.stop();
  server = null;
  void stopHubForegroundService();
}
