/**
 * Hub-side Nvidia Shield / Android TV control.
 *
 * Wraps the native androidtv-remote module: resolves the Shield's host (env pin
 * or a discovered SHIELD device), maps friendly ShieldKey names to Android
 * keycodes, and drives the one-time pairing flow the phone triggers over HTTP.
 */
import { createLogger, type ShieldKey, type ShieldStatus } from '@casacontrol/shared';
import {
  startPairing,
  sendPairingCode,
  connect,
  sendKey,
  launchApp,
  isPaired,
  status as nativeStatus,
} from '../modules/androidtv-remote';
import { ENV } from './env';
import { deviceStore } from './discovery/store';

const log = createLogger('shield');

/** Friendly key -> Android KeyEvent keycode. */
const KEYCODES: Record<ShieldKey, number> = {
  power: 26,
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  center: 23,
  back: 4,
  home: 3,
  menu: 82,
  play_pause: 85,
  rewind: 89,
  fast_forward: 90,
  volume_up: 24,
  volume_down: 25,
  mute: 164,
};

/** Find the Shield on the LAN if its IP wasn't pinned in env. */
function discoveredShieldIp(): string | null {
  const d = deviceStore
    .getState()
    .devices.find((x) =>
      /shield|nvidia|androidtv|android tv/i.test(`${x.name} ${x.model ?? ''} ${x.vendor ?? ''}`),
    );
  return d?.ip ?? null;
}

export function shieldHost(): string | null {
  return ENV.shieldIp || discoveredShieldIp();
}

export function shieldStatus(): ShieldStatus {
  const host = shieldHost();
  const s = nativeStatus();
  // Prefer the live native link; fall back to a paired-but-idle hint.
  let link = s.link as ShieldStatus['link'];
  if (link === 'disconnected' && host && isPaired(host)) link = 'disconnected';
  if (link === 'disconnected' && host && !isPaired(host)) link = 'unpaired';
  return {
    link,
    host: s.host ?? host,
    powered: s.powered ?? null,
    currentApp: null,
  };
}

/** Start pairing (TV shows a code). Resolves once the code is on screen. */
export async function shieldStartPairing(): Promise<{ ok: boolean; error?: string }> {
  const host = shieldHost();
  if (!host) return { ok: false, error: 'No Shield found. Set EXPO_PUBLIC_SHIELD_IP on the hub.' };
  try {
    await startPairing(host, 'CasaControl');
    log.info(`pairing started with ${host} - code shown on TV`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Submit the 6-char code from the TV. Resolves when paired + connected. */
export async function shieldSubmitCode(code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await sendPairingCode(code);
    log.info('pairing complete');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function shieldSendKey(key: ShieldKey): Promise<{ ok: boolean; error?: string }> {
  const host = shieldHost();
  if (!host) return { ok: false, error: 'No Shield configured' };
  if (!isPaired(host)) return { ok: false, error: 'Shield not paired yet - pair it first' };
  try {
    await sendKey(KEYCODES[key]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function shieldLaunch(target: string): Promise<{ ok: boolean; error?: string }> {
  const host = shieldHost();
  if (!host) return { ok: false, error: 'No Shield configured' };
  if (!isPaired(host)) return { ok: false, error: 'Shield not paired yet - pair it first' };
  try {
    await launchApp(target);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ensure the control channel is open (used before sending a burst of keys). */
export async function shieldConnect(): Promise<{ ok: boolean; error?: string }> {
  const host = shieldHost();
  if (!host) return { ok: false, error: 'No Shield configured' };
  try {
    await connect(host);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
