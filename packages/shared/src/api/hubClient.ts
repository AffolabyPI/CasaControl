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
} from '../types';
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

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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

  sendCommand(action: CasaAction): Promise<{ ok: boolean; result?: unknown }> {
    return this.fetchJson('/command', {
      method: 'POST',
      body: JSON.stringify(action),
    });
  }
}
