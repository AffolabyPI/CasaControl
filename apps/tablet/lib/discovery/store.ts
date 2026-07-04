/**
 * Tablet-side device store: runs the scanner, persists to SQLite, and exposes
 * the merged device list. Scans on startup and every DEVICE_SCAN_INTERVAL_MS.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import {
  DEVICE_SCAN_INTERVAL_MS,
  MDNS_SERVICES,
  createLogger,
  type Device,
} from '@casacontrol/shared';
import { listDevices, markStaleOffline, upsertDevice } from './db';
import { getSubnetBase, mdnsScan, pingSweep } from './scanner';

const log = createLogger('discovery');

interface DeviceStoreState {
  devices: Device[];
  scanning: boolean;
  lastScanAt: number | null;
  error: string | null;
  scanNow: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

const MDNS_TYPES = [
  MDNS_SERVICES.printer,
  MDNS_SERVICES.printerSecure,
  MDNS_SERVICES.cast,
  MDNS_SERVICES.airplay,
  MDNS_SERVICES.spotifyConnect,
];

export const deviceStore = createStore<DeviceStoreState>((set, get) => {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    devices: [],
    scanning: false,
    lastScanAt: null,
    error: null,

    scanNow: async () => {
      if (get().scanning) {
        log.debug('scan already in progress — skipping');
        return;
      }
      set({ scanning: true, error: null });
      const startedAt = Date.now();
      try {
        const base = await getSubnetBase();
        log.info(`scan started (subnet base: ${base ? `${base}.0/24` : 'unknown'})`);
        const namedByIp = new Map<string, Device>();

        // mDNS named services first (best info).
        const named = await mdnsScan(MDNS_TYPES);
        log.info(`mDNS resolved ${named.length} named device(s)`);
        for (const d of named) {
          log.debug(`  mDNS: ${d.name} → ${d.kind} @ ${d.ip}`);
          namedByIp.set(d.ip, d);
          await upsertDevice(d);
        }

        // Ping sweep fills in hosts mDNS didn't name.
        if (base) {
          const alive = await pingSweep(base);
          const unnamed = alive.filter((ip) => !namedByIp.has(ip));
          log.info(`ping sweep: ${alive.length} host(s) up, ${unnamed.length} unnamed`);
          for (const ip of unnamed) {
            await upsertDevice({
              id: ip,
              ip,
              hostname: null,
              mac: null,
              kind: 'generic',
              category: 'unknown',
              name: ip,
              lastSeen: Date.now(),
              online: true,
            });
          }
        } else {
          log.warn('no subnet base — skipping ping sweep (is WiFi connected?)');
        }

        await markStaleOffline(DEVICE_SCAN_INTERVAL_MS * 2);
        const devices = await listDevices();
        set({ devices, lastScanAt: Date.now() });
        log.info(
          `scan done in ${Date.now() - startedAt}ms — ${devices.length} device(s) total`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('scan failed', msg);
        set({ error: msg });
      } finally {
        set({ scanning: false });
      }
    },

    start: () => {
      if (timer) return;
      // Load whatever we persisted last session immediately, then scan.
      void listDevices().then((devices) => set({ devices }));
      void get().scanNow();
      timer = setInterval(() => void get().scanNow(), DEVICE_SCAN_INTERVAL_MS);
    },

    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
});

export function useDeviceStore<T>(selector: (s: DeviceStoreState) => T): T {
  return useStore(deviceStore, selector);
}
