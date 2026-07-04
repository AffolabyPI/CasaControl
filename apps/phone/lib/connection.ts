/**
 * Connection layer: chooses between Home (local WiFi) and Remote (Tailscale)
 * and hands out a HubClient pointed at the right base URL. Persisted in
 * SecureStore. The Settings screen (Phase 5) drives this; the Devices screen
 * (Phase 3) and assistant (Bonus) consume it.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { HubClient, createLogger } from '@casacontrol/shared';

const log = createLogger('connection');

export type ConnMode = 'home' | 'remote';

const KEYS = {
  mode: 'hub_mode',
  localIp: 'hub_local_ip',
  tailscaleIp: 'hub_tailscale_ip',
};

const DEFAULT_LOCAL = process.env.EXPO_PUBLIC_HUB_LOCAL_IP ?? '192.168.1.50';
const DEFAULT_TAILSCALE = process.env.EXPO_PUBLIC_HUB_TAILSCALE_IP ?? '';

interface ConnState {
  mode: ConnMode;
  localIp: string;
  tailscaleIp: string;
  latencyMs: number | null;
  reachable: boolean;
  connecting: boolean;
  hydrated: boolean;

  /** The base URL currently in use, derived from mode + the active IP. */
  activeUrl: () => string;
  hydrate: () => Promise<void>;
  setMode: (mode: ConnMode) => Promise<void>;
  setIps: (ips: { localIp?: string; tailscaleIp?: string }) => Promise<void>;
  ping: () => Promise<void>;
}

/** The single HubClient instance, re-pointed whenever mode/IP changes. */
export const hubClient = new HubClient(HubClient.fromIp(DEFAULT_LOCAL));

function activeIp(s: Pick<ConnState, 'mode' | 'localIp' | 'tailscaleIp'>): string {
  return s.mode === 'remote' ? s.tailscaleIp : s.localIp;
}

/** Point the HubClient at the active IP and log which URL we're now using. */
function repoint(s: Pick<ConnState, 'mode' | 'localIp' | 'tailscaleIp'>): string {
  const ip = activeIp(s);
  const url = HubClient.fromIp(ip);
  hubClient.setBaseUrl(url);
  log.info(`mode=${s.mode} → active IP ${ip || '<empty>'} → ${url}`);
  if (!ip) log.warn(`no IP set for ${s.mode} mode — set it in Settings`);
  return url;
}

export const connectionStore = createStore<ConnState>((set, get) => ({
  mode: 'home',
  localIp: DEFAULT_LOCAL,
  tailscaleIp: DEFAULT_TAILSCALE,
  latencyMs: null,
  reachable: false,
  connecting: false,
  hydrated: false,

  activeUrl: () => HubClient.fromIp(activeIp(get())),

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
    repoint(next);
    set({ ...next, hydrated: true });
    void get().ping();
  },

  setMode: async (mode) => {
    log.info(`switching mode → ${mode}`);
    await SecureStore.setItemAsync(KEYS.mode, mode);
    set({ mode });
    repoint(get());
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
    repoint(get());
    void get().ping();
  },

  ping: async () => {
    const url = get().activeUrl();
    if (!activeIp(get())) {
      log.warn('ping skipped — no IP configured for this mode');
      set({ reachable: false, latencyMs: null, connecting: false });
      return;
    }
    set({ connecting: true });
    log.info(`pinging ${url}/health …`);
    try {
      const latencyMs = await hubClient.pingLatency();
      log.info(`✓ hub reachable at ${url} (${latencyMs} ms)`);
      set({ latencyMs, reachable: true, connecting: false });
    } catch (e) {
      log.error(`✗ hub unreachable at ${url}`, String(e));
      set({ latencyMs: null, reachable: false, connecting: false });
    }
  },
}));

export function useConnection<T>(selector: (s: ConnState) => T): T {
  return useStore(connectionStore, selector);
}
