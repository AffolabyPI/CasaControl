/**
 * Phone-side devices store — fetches the discovered device list from the hub.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Device } from '@casacontrol/shared';
import { hubClient } from './connection';

interface DevicesState {
  devices: Device[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const devicesStore = createStore<DevicesState>((set) => ({
  devices: [],
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      set({ devices: await hubClient.getDevices() });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ loading: false });
    }
  },
}));

export function useDevices<T>(selector: (s: DevicesState) => T): T {
  return useStore(devicesStore, selector);
}
