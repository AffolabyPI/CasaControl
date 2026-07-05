/**
 * Connection layer: chooses between Home (local WiFi) and Remote (Tailscale)
 * and hands out a HubClient pointed at the right base URL. Persisted in
 * SecureStore. The Settings screen (Phase 5) drives this; the Devices screen
 * (Phase 3) and assistant (Bonus) consume it.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { HubClient, createLogger, type HubHealth } from '@casacontrol/shared';

const log = createLogger('connection');

export type ConnMode = 'home' | 'remote';

const KEYS = {
  mode: 'hub_mode',
  localIp: 'hub_local_ip',
  tailscaleIp: 'hub_tailscale_ip',
};

const DEFAULT_LOCAL = process.env.EXPO_PUBLIC_HUB_LOCAL_IP ?? '192.168.1.50';
const DEFAULT_TAILSCALE = process.env.EXPO_PUBLIC_HUB_TAILSCALE_IP ?? '';

// Health-monitor cadence: steady when connected, quick-but-backing-off when not.
const UP_INTERVAL_MS = 6_000;
const DOWN_MIN_MS = 2_000;
const DOWN_MAX_MS = 12_000;
const PROBE_TIMEOUT_MS = 3_000;

interface ConnState {
  /** User's preferred endpoint. Failover may temporarily use the other one. */
  mode: ConnMode;
  localIp: string;
  tailscaleIp: string;
  latencyMs: number | null;
  reachable: boolean;
  connecting: boolean;
  hydrated: boolean;
  /** Which endpoint the client is actually pointed at right now (null if down). */
  activeEndpoint: ConnMode | null;
  /** Auto-fail over to the other endpoint when the preferred one is unreachable. */
  autoFailover: boolean;
  /** Latest hub health payload (version, mode, device count, spotify). */
  health: HubHealth | null;

  /** The base URL for the preferred mode. */
  activeUrl: () => string;
  hydrate: () => Promise<void>;
  setMode: (mode: ConnMode) => Promise<void>;
  setIps: (ips: { localIp?: string; tailscaleIp?: string }) => Promise<void>;
  setAutoFailover: (on: boolean) => void;
  /** Run one health probe (with failover) and update state. */
  ping: () => Promise<void>;
  startMonitor: () => void;
  stopMonitor: () => void;
}

/** The single HubClient instance, re-pointed as the reachable endpoint changes. */
export const hubClient = new HubClient(HubClient.fromIp(DEFAULT_LOCAL));

function ipFor(s: Pick<ConnState, 'localIp' | 'tailscaleIp'>, endpoint: ConnMode): string {
  return endpoint === 'remote' ? s.tailscaleIp : s.localIp;
}

/** Point the HubClient at a specific endpoint's IP. */
function repointTo(s: Pick<ConnState, 'localIp' | 'tailscaleIp'>, endpoint: ConnMode): void {
  const url = HubClient.fromIp(ipFor(s, endpoint));
  hubClient.setBaseUrl(url);
  log.info(`active endpoint → ${endpoint} → ${url}`);
}

// Self-scheduling monitor state (module-scoped so it isn't part of store data).
let monitorTimer: ReturnType<typeof setTimeout> | null = null;
let downStreak = 0;

export const connectionStore = createStore<ConnState>((set, get) => ({
  mode: 'home',
  localIp: DEFAULT_LOCAL,
  tailscaleIp: DEFAULT_TAILSCALE,
  latencyMs: null,
  reachable: false,
  connecting: false,
  hydrated: false,
  activeEndpoint: null,
  autoFailover: true,
  health: null,

  activeUrl: () => HubClient.fromIp(ipFor(get(), get().mode)),

  hydrate: async () => {
    const [mode, localIp, tailscaleIp] = await Promise.all([
      SecureStore.getItemAsync(KEYS.mode),
      SecureStore.getItemAsync(KEYS.localIp),
      SecureStore.getItemAsync(KEYS.tailscaleIp),
    ]);
    const next = {
      mode: (mode as ConnMode) ?? 'home',
      localIp: localIp ?? DEFAULT_LOCAL,
      tailscaleIp: tailscaleIp ?? DEFAULT_TAILSCALE,
    };
    log.info(
      `hydrated — mode=${next.mode} local=${next.localIp} tailscale=${next.tailscaleIp || '<empty>'}`,
    );
    repointTo(next, next.mode);
    set({ ...next, hydrated: true });
    get().startMonitor();
  },

  setMode: async (mode) => {
    log.info(`preferred endpoint → ${mode}`);
    await SecureStore.setItemAsync(KEYS.mode, mode);
    set({ mode });
    repointTo(get(), mode);
    downStreak = 0;
    void get().ping();
  },

  setIps: async ({ localIp, tailscaleIp }) => {
    if (localIp !== undefined) {
      log.info(`save local IP = ${localIp || '<empty>'}`);
      await SecureStore.setItemAsync(KEYS.localIp, localIp);
    }
    if (tailscaleIp !== undefined) {
      log.info(`save tailscale IP = ${tailscaleIp || '<empty>'}`);
      await SecureStore.setItemAsync(KEYS.tailscaleIp, tailscaleIp);
    }
    set((s) => ({
      localIp: localIp ?? s.localIp,
      tailscaleIp: tailscaleIp ?? s.tailscaleIp,
    }));
    repointTo(get(), get().mode);
    downStreak = 0;
    void get().ping();
  },

  setAutoFailover: (on) => {
    log.info(`auto-failover ${on ? 'on' : 'off'}`);
    set({ autoFailover: on });
    downStreak = 0;
    void get().ping();
  },

  ping: async () => {
    const s = get();
    const preferred = s.mode;
    const other: ConnMode = preferred === 'home' ? 'remote' : 'home';

    set({ connecting: true });

    // Try the preferred endpoint first.
    const preferredUrl = HubClient.fromIp(ipFor(s, preferred));
    let probe = preferredUrl
      ? await HubClient.probe(preferredUrl, PROBE_TIMEOUT_MS)
      : { ok: false, latencyMs: 0 };
    let endpoint: ConnMode = preferred;

    // Fall back to the other endpoint if allowed and configured.
    if (!probe.ok && s.autoFailover) {
      const otherUrl = HubClient.fromIp(ipFor(s, other));
      if (otherUrl) {
        const op = await HubClient.probe(otherUrl, PROBE_TIMEOUT_MS);
        if (op.ok) {
          probe = op;
          endpoint = other;
          log.info(`preferred ${preferred} down — failed over to ${other}`);
        }
      }
    }

    if (probe.ok) {
      if (get().activeEndpoint !== endpoint) repointTo(get(), endpoint);
      set({
        reachable: true,
        latencyMs: probe.latencyMs,
        health: probe.health ?? null,
        activeEndpoint: endpoint,
        connecting: false,
      });
    } else {
      set({
        reachable: false,
        latencyMs: null,
        health: null,
        activeEndpoint: null,
        connecting: false,
      });
    }
  },

  startMonitor: () => {
    if (monitorTimer) return;
    log.info('health monitor started');
    const loop = async (): Promise<void> => {
      await get().ping();
      const ok = get().reachable;
      downStreak = ok ? 0 : downStreak + 1;
      const delay = ok
        ? UP_INTERVAL_MS
        : Math.min(DOWN_MAX_MS, DOWN_MIN_MS * Math.pow(1.6, downStreak - 1));
      monitorTimer = setTimeout(() => void loop(), delay);
    };
    void loop();
  },

  stopMonitor: () => {
    if (monitorTimer) {
      clearTimeout(monitorTimer);
      monitorTimer = null;
      log.info('health monitor stopped');
    }
  },
}));

export function useConnection<T>(selector: (s: ConnState) => T): T {
  return useStore(connectionStore, selector);
}
