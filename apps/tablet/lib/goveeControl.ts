/**
 * Hub-side Govee light control.
 *
 * Wraps the shared GoveeController with the tablet's API key (from env) and
 * resolves a *default* target light so phone/assistant commands can omit the
 * sku+device. The device list is cached briefly to avoid hammering the cloud API
 * (which is rate-limited) on every control tap.
 */
import {
  GoveeController,
  createLogger,
  type GoveeDevice,
  type GoveeScene,
  type GoveeDiyScene,
  type GoveeLightState,
} from '@casacontrol/shared';
import { ENV } from './env';

const log = createLogger('govee');

let controller: GoveeController | null = null;
function client(): GoveeController {
  if (!ENV.goveeApiKey) throw new Error('Govee API key not set (EXPO_PUBLIC_GOVEE_API_KEY)');
  controller ??= new GoveeController(ENV.goveeApiKey);
  return controller;
}

export function goveeConfigured(): boolean {
  return !!ENV.goveeApiKey;
}

// Short-lived device-list cache (the account's lights rarely change).
let deviceCache: { at: number; devices: GoveeDevice[] } | null = null;
const CACHE_MS = 60_000;

export async function listGoveeDevices(force = false): Promise<GoveeDevice[]> {
  if (!force && deviceCache && Date.now() - deviceCache.at < CACHE_MS) {
    return deviceCache.devices;
  }
  const devices = await client().listDevices();
  deviceCache = { at: Date.now(), devices };
  return devices;
}

/**
 * Resolve the target light for a command. Explicit sku+device (from the phone
 * UI) win; otherwise fall back to the env-pinned light, then the first light on
 * the account that supports colour or scenes.
 */
async function resolveTarget(
  sku?: string,
  device?: string,
): Promise<{ sku: string; device: string }> {
  if (sku && device) return { sku, device };
  if (ENV.goveeSku && ENV.goveeDevice) return { sku: ENV.goveeSku, device: ENV.goveeDevice };
  const devices = await listGoveeDevices();
  const pick =
    devices.find((d) => d.capabilities.scenes || d.capabilities.colorRgb) ?? devices[0];
  if (!pick) throw new Error('No Govee devices found on this account');
  return { sku: pick.sku, device: pick.device };
}

export async function listGoveeScenes(sku?: string, device?: string): Promise<GoveeScene[]> {
  const t = await resolveTarget(sku, device);
  return client().listScenes(t.sku, t.device);
}

export async function listGoveeDiyScenes(sku?: string, device?: string): Promise<GoveeDiyScene[]> {
  const t = await resolveTarget(sku, device);
  return client().listDiyScenes(t.sku, t.device);
}

export async function goveeState(sku?: string, device?: string): Promise<GoveeLightState> {
  const t = await resolveTarget(sku, device);
  return client().getState(t.sku, t.device);
}

export async function goveePower(on: boolean, sku?: string, device?: string): Promise<{ ok: true }> {
  const t = await resolveTarget(sku, device);
  await client().setPower(t.sku, t.device, on);
  log.info(`power ${on ? 'on' : 'off'} -> ${t.sku}/${t.device}`);
  return { ok: true };
}

export async function goveeBrightness(value: number, sku?: string, device?: string): Promise<{ ok: true }> {
  const t = await resolveTarget(sku, device);
  await client().setBrightness(t.sku, t.device, value);
  return { ok: true };
}

export async function goveeColor(rgb: number, sku?: string, device?: string): Promise<{ ok: true }> {
  const t = await resolveTarget(sku, device);
  await client().setColorRgb(t.sku, t.device, rgb);
  return { ok: true };
}

export async function goveeColorTemp(kelvin: number, sku?: string, device?: string): Promise<{ ok: true }> {
  const t = await resolveTarget(sku, device);
  await client().setColorTemperature(t.sku, t.device, kelvin);
  return { ok: true };
}

export async function goveeScene(
  sceneId: number,
  paramId: number,
  sku?: string,
  device?: string,
): Promise<{ ok: true }> {
  const t = await resolveTarget(sku, device);
  await client().setScene(t.sku, t.device, sceneId, paramId);
  return { ok: true };
}

export async function goveeDiyScene(value: number, sku?: string, device?: string): Promise<{ ok: true }> {
  const t = await resolveTarget(sku, device);
  await client().setDiyScene(t.sku, t.device, value);
  return { ok: true };
}
