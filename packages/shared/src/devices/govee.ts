/**
 * Govee cloud control (Developer Platform API v2).
 *
 * Controls Govee Wi-Fi lights (e.g. the Gaming Pixel Light H6630/H6631) through
 * Govee's cloud REST API. Unlike the LAN API, the cloud API exposes *scenes* —
 * the whole point of a pixel light — plus on/off, brightness, and colour.
 *
 * Pure `fetch`, no native deps, so it lives in @casacontrol/shared. The API key
 * is a per-account secret (Govee Home app -> Profile -> About Us -> Apply for
 * API Key); it is held only on the tablet hub, never in the phone bundle.
 *
 * Docs: https://developer.govee.com/reference/control-you-devices
 */
import type { GoveeDevice, GoveeScene, GoveeLightState } from '../types';

const BASE_URL = 'https://openapi.api.govee.com';

/** Capability type/instance pairs the API uses. */
const CAP = {
  power: { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
  brightness: { type: 'devices.capabilities.range', instance: 'brightness' },
  colorRgb: { type: 'devices.capabilities.color_setting', instance: 'colorRgb' },
  colorTempK: { type: 'devices.capabilities.color_setting', instance: 'colorTemperatureK' },
  scene: { type: 'devices.capabilities.dynamic_scene', instance: 'lightScene' },
} as const;

/** Encode an 0-255 RGB triple into the single integer Govee expects. */
export function rgbToInt(r: number, g: number, b: number): number {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

/** Split a Govee colour integer back into an {r,g,b} triple. */
export function intToRgb(v: number): { r: number; g: number; b: number } {
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

interface RawCapability {
  type?: string;
  instance?: string;
  state?: { value?: unknown };
  parameters?: { options?: Array<{ name?: string; value?: unknown }> };
}
interface RawDevice {
  sku?: string;
  device?: string;
  deviceName?: string;
  type?: string;
  capabilities?: RawCapability[];
}

function reqId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Which of the controls we care about a device advertises. */
function summarizeCaps(caps: RawCapability[] = []): GoveeDevice['capabilities'] {
  const has = (t: string, i: string) =>
    caps.some((c) => c.type === t && c.instance === i);
  return {
    power: has(CAP.power.type, CAP.power.instance),
    brightness: has(CAP.brightness.type, CAP.brightness.instance),
    colorRgb: has(CAP.colorRgb.type, CAP.colorRgb.instance),
    colorTemp: has(CAP.colorTempK.type, CAP.colorTempK.instance),
    scenes: has(CAP.scene.type, CAP.scene.instance),
  };
}

export class GoveeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GoveeError';
  }
}

export class GoveeController {
  constructor(private readonly apiKey: string) {}

  private async call<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Govee-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const msg =
        (json as { message?: string } | null)?.message ??
        `Govee ${path} -> ${res.status}`;
      throw new GoveeError(msg, res.status);
    }
    // The API also signals logical errors via a non-200 `code` in a 200 body.
    const code = (json as { code?: number } | null)?.code;
    if (code !== undefined && code !== 200 && code !== 0) {
      const msg = (json as { message?: string } | null)?.message ?? `Govee code ${code}`;
      throw new GoveeError(msg, code);
    }
    return json as T;
  }

  /** Send one capability control command. */
  private control(
    sku: string,
    device: string,
    capability: { type: string; instance: string },
    value: unknown,
  ): Promise<unknown> {
    return this.call('/router/api/v1/device/control', 'POST', {
      requestId: reqId(),
      payload: { sku, device, capability: { ...capability, value } },
    });
  }

  /** All controllable devices on the account, with a capability summary. */
  async listDevices(): Promise<GoveeDevice[]> {
    const data = await this.call<{ data?: RawDevice[] }>(
      '/router/api/v1/user/devices',
      'GET',
    );
    return (data.data ?? [])
      .filter((d) => d.sku && d.device)
      .map((d) => ({
        sku: d.sku!,
        device: d.device!,
        name: d.deviceName?.trim() || d.sku!,
        type: d.type ?? '',
        capabilities: summarizeCaps(d.capabilities),
      }));
  }

  /** The device's available dynamic scenes (the pixel-light "scenes"). */
  async listScenes(sku: string, device: string): Promise<GoveeScene[]> {
    const data = await this.call<{ payload?: { capabilities?: RawCapability[] } }>(
      '/router/api/v1/device/scenes',
      'POST',
      { requestId: reqId(), payload: { sku, device } },
    );
    const cap = (data.payload?.capabilities ?? []).find(
      (c) => c.type === CAP.scene.type && c.instance === CAP.scene.instance,
    );
    const opts = cap?.parameters?.options ?? [];
    return opts
      .map((o) => {
        const v = (o.value ?? {}) as { id?: number; paramId?: number };
        return { name: o.name ?? 'Scene', id: Number(v.id ?? 0), paramId: Number(v.paramId ?? 0) };
      })
      .filter((s) => s.id > 0);
  }

  /** Current on/off + brightness + colour, best-effort. */
  async getState(sku: string, device: string): Promise<GoveeLightState> {
    const data = await this.call<{ payload?: { capabilities?: RawCapability[] } }>(
      '/router/api/v1/device/state',
      'POST',
      { requestId: reqId(), payload: { sku, device } },
    );
    const caps = data.payload?.capabilities ?? [];
    const valOf = (t: string, i: string): unknown =>
      caps.find((c) => c.type === t && c.instance === i)?.state?.value;

    const online = valOf('devices.capabilities.online', 'online');
    const power = valOf(CAP.power.type, CAP.power.instance);
    const brightness = valOf(CAP.brightness.type, CAP.brightness.instance);
    const color = valOf(CAP.colorRgb.type, CAP.colorRgb.instance);
    return {
      online: online === undefined ? true : Boolean(online),
      on: power === undefined ? null : Number(power) === 1,
      brightness: brightness === undefined ? null : Number(brightness),
      colorRgb: color === undefined ? null : Number(color),
    };
  }

  setPower(sku: string, device: string, on: boolean): Promise<unknown> {
    return this.control(sku, device, CAP.power, on ? 1 : 0);
  }

  /** Brightness as a 1-100 percentage. */
  setBrightness(sku: string, device: string, percent: number): Promise<unknown> {
    const v = Math.max(1, Math.min(100, Math.round(percent)));
    return this.control(sku, device, CAP.brightness, v);
  }

  setColorRgb(sku: string, device: string, rgb: number): Promise<unknown> {
    return this.control(sku, device, CAP.colorRgb, rgb & 0xffffff);
  }

  /** Colour temperature in Kelvin (typically 2000-9000). */
  setColorTemperature(sku: string, device: string, kelvin: number): Promise<unknown> {
    const v = Math.max(2000, Math.min(9000, Math.round(kelvin)));
    return this.control(sku, device, CAP.colorTempK, v);
  }

  /** Activate a dynamic scene (from listScenes). */
  setScene(sku: string, device: string, sceneId: number, paramId: number): Promise<unknown> {
    return this.control(sku, device, CAP.scene, { id: sceneId, paramId });
  }
}
