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
  pairedHost,
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

/**
 * Resolve the Shield host. Prefer an explicit env pin, then live discovery, then
 * the last host we actually paired with (persisted natively). The persisted
 * fallback is what keeps commands working when discovery momentarily drops the
 * Shield between LAN scans - the cause of the intermittent "not paired yet".
 */
export function shieldHost(): string | null {
  return ENV.shieldIp || discoveredShieldIp() || pairedHost();
}

export function shieldStatus(): ShieldStatus {
  const host = shieldHost();
  const s = nativeStatus();
  const paired = host ? isPaired(host) : false;
  let link = s.link as ShieldStatus['link'];
  // Never-paired: always show 'unpaired' when idle. Paired-but-idle: 'disconnected'.
  if (!paired && link !== 'pairing') link = 'unpaired';
  else if (paired && (link === 'unpaired' || link === 'disconnected')) {
    link = s.link === 'connected' ? 'connected' : 'disconnected';
  }
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
  if (!host) return { ok: false, error: 'No Shield found on the network' };
  // Don't hard-gate on isPaired: LAN discovery flux made that give false
  // "not paired" errors. Instead ensure the (cert-authenticated) connection and
  // send; only report "pair it first" if we've genuinely never paired.
  try {
    await connect(host);
    await sendKey(KEYCODES[key]);
    return { ok: true };
  } catch (e) {
    if (!isPaired(host)) return { ok: false, error: 'Shield not paired yet - pair it first' };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function shieldLaunch(target: string): Promise<{ ok: boolean; error?: string }> {
  const host = shieldHost();
  if (!host) return { ok: false, error: 'No Shield found on the network' };
  try {
    await connect(host);
    await launchApp(target);
    return { ok: true };
  } catch (e) {
    if (!isPaired(host)) return { ok: false, error: 'Shield not paired yet - pair it first' };
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
