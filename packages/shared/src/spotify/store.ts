/**
 * Shared Spotify Zustand store (vanilla — framework-agnostic).
 *
 * Each app creates one instance with its own SpotifyClient, then subscribes to
 * it via zustand's `useStore`. Controls are optimistic: they mutate local state
 * immediately, fire the API call, then reconcile on the next poll.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SpotifyDevice, SpotifyPlaybackState } from '../types';
import { SPOTIFY_POLL_MS } from '../constants';
import { SpotifyApiError, type SpotifyClient } from './client';
import { createLogger } from '../log';

const log = createLogger('spotify-store');

export interface SpotifyState {
  playback: SpotifyPlaybackState | null;
  devices: SpotifyDevice[];
  isAuthed: boolean;
  isPolling: boolean;
  error: string | null;

  // lifecycle
  startPolling: () => void;
  stopPolling: () => void;
  refresh: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  setAuthed: (authed: boolean) => void;

  // controls (optimistic)
  play: () => Promise<void>;
  pause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  /** Jump to a position (ms) within the current track. */
  seek: (positionMs: number) => Promise<void>;
  /** Restart the current track from 0 (distinct from `previous`). */
  restart: () => Promise<void>;
  setVolume: (percent: number) => Promise<void>;
  transfer: (deviceId: string) => Promise<void>;
}

export type SpotifyStore = StoreApi<SpotifyState>;

export function createSpotifyStore(
  client: SpotifyClient,
  pollMs: number = SPOTIFY_POLL_MS,
): SpotifyStore {
  let timer: ReturnType<typeof setInterval> | null = null;

  return createStore<SpotifyState>((set, get) => {
    const guarded = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
        if (get().error) set({ error: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(`${label} failed: ${msg}`);
        set({ error: msg });
      }
    };

    return {
      playback: null,
      devices: [],
      isAuthed: false,
      isPolling: false,
      error: null,

      setAuthed: (authed) => set({ isAuthed: authed }),

      startPolling: () => {
        if (timer || !get().isAuthed) return;
        set({ isPolling: true });
        void get().refresh();
        void get().refreshDevices();
        timer = setInterval(() => {
          void get().refresh();
        }, pollMs);
      },

      stopPolling: () => {
        if (timer) clearInterval(timer);
        timer = null;
        set({ isPolling: false });
      },

      refresh: () =>
        guarded('refresh', async () => {
          const playback = await client.getPlaybackState();
          set({ playback });
        }),

      refreshDevices: () =>
        guarded('refreshDevices', async () => {
          const devices = await client.getDevices();
          set({ devices });
        }),

      play: () =>
        guarded('play', async () => {
          const p = get().playback;
          if (p) set({ playback: { ...p, isPlaying: true } });
          try {
            await client.play();
          } catch (e) {
            // 404 "No active device found" — Spotify has no device to resume on
            // (nothing played recently). Pick an available device and start there.
            if (e instanceof SpotifyApiError && e.status === 404) {
              let devices = get().devices;
              if (devices.length === 0) {
                devices = await client.getDevices();
                set({ devices });
              }
              const target = devices.find((d) => d.isActive) ?? devices[0];
              if (!target) {
                throw new Error(
                  'No Spotify device available — open Spotify on your phone, the tablet, or a speaker first.',
                );
              }
              await client.transferPlayback(target.id, true);
            } else {
              throw e;
            }
          }
          await get().refresh();
          await get().refreshDevices();
        }),

      pause: () =>
        guarded('pause', async () => {
          const p = get().playback;
          if (p) set({ playback: { ...p, isPlaying: false } });
          await client.pause();
          await get().refresh();
        }),

      next: () =>
        guarded('next', async () => {
          await client.next();
          await get().refresh();
        }),

      previous: () =>
        guarded('previous', async () => {
          await client.previous();
          await get().refresh();
        }),

      seek: (positionMs) =>
        guarded('seek', async () => {
          const p = get().playback;
          // Optimistic: show the new position immediately, reset the interp base.
          if (p) set({ playback: { ...p, progressMs: positionMs, fetchedAt: Date.now() } });
          await client.seek(positionMs);
          await get().refresh();
        }),

      restart: () =>
        guarded('restart', async () => {
          const p = get().playback;
          if (p) set({ playback: { ...p, progressMs: 0, fetchedAt: Date.now() } });
          await client.restart();
          await get().refresh();
        }),

      setVolume: (percent) =>
        guarded('setVolume', async () => {
          const p = get().playback;
          if (p) set({ playback: { ...p, volumePercent: Math.round(percent) } });
          await client.setVolume(percent);
        }),

      transfer: (deviceId) =>
        guarded('transfer', async () => {
          await client.transferPlayback(deviceId);
          await get().refresh();
          await get().refreshDevices();
        }),
    };
  });
}
