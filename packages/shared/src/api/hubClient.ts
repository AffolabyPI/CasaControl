/**
 * HubClient — the phone's HTTP interface to the tablet hub.
 *
 * The tablet runs a tiny TCP/HTTP server (react-native-tcp-socket) exposing:
 *   GET  /health              -> { ok, uptimeMs }
 *   GET  /devices             -> Device[]
 *   GET  /playback            -> SpotifyPlaybackState
 *   GET  /ps5/status          -> Ps5Status
 *   GET  /printer/status      -> PrinterStatus
 *   GET  /system/volume       -> { volume: 0-100 }   (tablet media volume)
 *   POST /command  {CasaAction}-> { ok, result? }
 *
 * `baseUrl` is swapped between the local WiFi IP and the Tailscale IP (Phase 5).
 */
import type {
  CasaAction,
  Device,
  Ps5Status,
  PrinterStatus,
  SpotifyPlaybackState,
  GoveeDevice,
  GoveeScene,
  GoveeDiyScene,
  GoveeLightState,
  ShieldStatus,
} from '../types';
import type { DeviceProfile } from '../devices/profiles/schema';
import { HUB_SERVER_PORT } from '../constants';

export interface HubHealth {
  ok: boolean;
  uptimeMs: number;
  /** App version reported by the hub. */
  version?: string;
  /** Whether the tablet is in dashboard (screen-on) or private (screen-off) mode. */
  hubMode?: 'dashboard' | 'private';
  /** Number of devices currently discovered on the LAN. */
  deviceCount?: number;
  /** Whether the tablet's Spotify App Remote is connected (locked cold-start ready). */
  spotifyConnected?: boolean;
}

/** Result of probing a single hub endpoint (used for reachability/failover). */
export interface HubProbe {
  ok: boolean;
  latencyMs: number;
  health?: HubHealth;
}

export class HubClient {
  constructor(
    private baseUrl: string,
    private readonly timeoutMs = 5_000,
  ) {}

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /** Build `http://host:port` from a bare IP, or pass a full URL through. */
  static fromIp(ip: string, port: number = HUB_SERVER_PORT): string {
    return ip.startsWith('http') ? ip : `http://${ip}:${port}`;
  }

  /**
   * Probe a specific hub URL without touching any client instance — used by the
   * connection monitor to check reachability + failover to the other endpoint.
   */
  static async probe(baseUrl: string, timeoutMs = 3_000): Promise<HubProbe> {
    if (!baseUrl) return { ok: false, latencyMs: 0 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
      if (!res.ok) return { ok: false, latencyMs: Date.now() - start };
      const health = (await res.json()) as HubHealth;
      return { ok: true, latencyMs: Date.now() - start, health };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchJson<T>(path: string, init?: RequestInit, timeoutMs = this.timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (!res.ok) throw new Error(`Hub ${path} -> ${res.status}`);
      // Parse defensively: a transient/garbled response shouldn't surface as a
      // cryptic "JSON Parse error: unexpected character" — report what we got.
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(
          `Hub ${path}: unexpected response "${text.slice(0, 30).replace(/\s+/g, ' ')}"`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<HubHealth> {
    return this.fetchJson<HubHealth>('/health');
  }

  /** Round-trip latency to the hub in ms (used by the connection badge). */
  async pingLatency(): Promise<number> {
    const start = Date.now();
    await this.health();
    return Date.now() - start;
  }

  getDevices(): Promise<Device[]> {
    return this.fetchJson<Device[]>('/devices');
  }

  getPlayback(): Promise<SpotifyPlaybackState> {
    return this.fetchJson<SpotifyPlaybackState>('/playback');
  }

  getPs5Status(): Promise<Ps5Status> {
    return this.fetchJson<Ps5Status>('/ps5/status');
  }

  getPrinterStatus(): Promise<PrinterStatus> {
    return this.fetchJson<PrinterStatus>('/printer/status');
  }

  /** The tablet's current media volume (0–100) — i.e. the Bluetooth speaker's. */
  async getSystemVolume(): Promise<number> {
    const { volume } = await this.fetchJson<{ volume: number }>('/system/volume');
    return volume;
  }

  /** Set the tablet's media volume (0–100). Controls the connected speaker. */
  async setSystemVolume(percent: number): Promise<void> {
    const v = Math.max(0, Math.min(100, Math.round(percent)));
    await this.sendCommand({ action: 'system.setVolume', volume: v });
  }

  /**
   * Run a CasaAction on the hub. `timeoutMs` overrides the default abort window
   * for slow actions — BLE speaker wake/sleep can take ~10s (connect + GATT
   * write), well past the 5s default, and would otherwise abort mid-success.
   */
  sendCommand(action: CasaAction, timeoutMs?: number): Promise<{ ok: boolean; result?: unknown }> {
    return this.fetchJson(
      '/command',
      { method: 'POST', body: JSON.stringify(action) },
      timeoutMs,
    );
  }

  // --- Govee lights ---

  /** Controllable Govee lights on the hub's account. */
  getGoveeDevices(): Promise<GoveeDevice[]> {
    return this.fetchJson<GoveeDevice[]>('/govee/devices');
  }

  /** Dynamic scenes for a specific light (sku+device from getGoveeDevices). */
  getGoveeScenes(sku: string, device: string): Promise<GoveeScene[]> {
    const q = `?sku=${encodeURIComponent(sku)}&device=${encodeURIComponent(device)}`;
    return this.fetchJson<GoveeScene[]>(`/govee/scenes${q}`);
  }

  /** DIY scenes (user-created in the Govee app) for a specific light. */
  getGoveeDiyScenes(sku: string, device: string): Promise<GoveeDiyScene[]> {
    const q = `?sku=${encodeURIComponent(sku)}&device=${encodeURIComponent(device)}`;
    return this.fetchJson<GoveeDiyScene[]>(`/govee/diy-scenes${q}`);
  }

  /** Current on/off + brightness + colour of a light. */
  getGoveeState(sku: string, device: string): Promise<GoveeLightState> {
    const q = `?sku=${encodeURIComponent(sku)}&device=${encodeURIComponent(device)}`;
    return this.fetchJson<GoveeLightState>(`/govee/state${q}`);
  }

  // --- Nvidia Shield / Android TV ---

  /** Current link + power state of the Shield remote. */
  getShieldStatus(): Promise<ShieldStatus> {
    return this.fetchJson<ShieldStatus>('/shield/status');
  }

  /** Begin pairing — the TV shows a 6-char code. Pairing can take a few seconds. */
  shieldPairStart(): Promise<{ ok: boolean; error?: string }> {
    return this.fetchJson('/shield/pair/start', { method: 'POST', body: '{}' }, 15_000);
  }

  /** Submit the code shown on the TV. Resolves when paired. */
  shieldPairCode(code: string): Promise<{ ok: boolean; error?: string }> {
    return this.fetchJson('/shield/pair/code', { method: 'POST', body: JSON.stringify({ code }) }, 15_000);
  }

  /** Open the control channel to an already-paired Shield. */
  shieldConnect(): Promise<{ ok: boolean; error?: string }> {
    return this.fetchJson('/shield/connect', { method: 'POST', body: '{}' }, 10_000);
  }

  // --- Adaptive device profiles ---

  /** All cached profiles (builtin + approved ai_generated). */
  getProfiles(): Promise<DeviceProfile[]> {
    return this.fetchJson<DeviceProfile[]>('/profiles');
  }

  /** Persist an approved profile on the hub (validated hub-side before saving). */
  saveProfile(profile: DeviceProfile): Promise<{ ok: boolean; error?: string }> {
    return this.fetchJson('/profiles/save', { method: 'POST', body: JSON.stringify(profile) });
  }

  /**
   * Run one action of a stored profile against a target device. The hub returns
   * the executor result flat: `{ ok, detail }` (with `error` on a hub-level
   * failure), not wrapped in `{ result }`.
   */
  executeProfile(
    profileId: string,
    actionName: string,
    target: { targetMac?: string; targetIp?: string; bleDeviceId?: string } = {},
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    return this.fetchJson('/profiles/execute', {
      method: 'POST',
      body: JSON.stringify({ profileId, actionName, target }),
    });
  }

  deleteProfile(profileId: string): Promise<{ ok: boolean; error?: string }> {
    return this.fetchJson('/profiles/delete', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    });
  }
}
