/**
 * Hub display mode:
 *  - 'dashboard' — always-on dashboard: screen kept awake (dims when idle).
 *  - 'private'   — screen allowed to sleep + lock, so the tablet's logged-in
 *                  apps aren't exposed if someone picks it up. The hub keeps
 *                  running headless via the foreground service.
 *
 * The choice is persisted so the tablet restores it after a reboot.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { createLogger } from '@casacontrol/shared';

const log = createLogger('hubmode');
const KEY = 'hub_mode';

export type HubMode = 'dashboard' | 'private';

interface HubModeState {
  mode: HubMode;
  setMode: (mode: HubMode) => void;
  toggle: () => void;
  hydrate: () => Promise<void>;
}

export const hubModeStore = createStore<HubModeState>((set, get) => ({
  mode: 'dashboard',
  setMode: (mode) => {
    set({ mode });
    void SecureStore.setItemAsync(KEY, mode).catch((e) => log.warn('persist failed', String(e)));
  },
  toggle: () => get().setMode(get().mode === 'dashboard' ? 'private' : 'dashboard'),
  hydrate: async () => {
    const saved = (await SecureStore.getItemAsync(KEY)) as HubMode | null;
    if (saved === 'dashboard' || saved === 'private') {
      set({ mode: saved });
      log.info(`restored hub mode: ${saved}`);
    }
  },
}));

export const useHubMode = () => useStore(hubModeStore, (s) => s.mode);
export const toggleHubMode = () => hubModeStore.getState().toggle();
