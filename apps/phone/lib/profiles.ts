/**
 * Phone-side adaptive device profiles.
 *
 * Cache-first: profiles are fetched from the hub and matched CLIENT-SIDE with the
 * shared findMatchingProfile. Research (a Claude web-search call) is only ever
 * offered/run for a device that matchFor() returns null for — so an approved
 * profile is reused forever and Claude is never re-invoked for a known device.
 *
 * Approve → hub persists it. Execute/delete → hub. Research runs here because the
 * Anthropic key lives on the phone (SecureStore), like the rest of the assistant.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import {
  ClaudeClient,
  findMatchingProfile,
  createLogger,
  type Device,
  type DeviceProfile,
  type DeviceMatchInput,
  type ResearchInput,
} from '@casacontrol/shared';
import { hubClient } from './connection';
import { getApiKey } from './assistant';

const log = createLogger('profiles');

function toMatchInput(d: Device): DeviceMatchInput {
  return { name: d.name, mac: d.mac };
}
function toResearchInput(d: Device): ResearchInput {
  return { name: d.name, vendor: d.vendor, model: d.model, mac: d.mac };
}

export interface PendingReview {
  deviceId: string;
  deviceName: string;
  profile: DeviceProfile;
}

interface ProfilesState {
  profiles: DeviceProfile[];
  loading: boolean;
  /** Device id currently being researched (for a spinner on its row). */
  researchingId: string | null;
  /** A researched-but-unapproved profile awaiting the approval gate. */
  pending: PendingReview | null;
  error: string | null;

  refresh: () => Promise<void>;
  /** Cache-first match — the gate research must fail before it can run. */
  matchFor: (device: Device) => DeviceProfile | null;
  research: (device: Device) => Promise<void>;
  approve: () => Promise<void>;
  discard: () => void;
  runAction: (
    profileId: string,
    actionName: string,
    device: Device,
  ) => Promise<{ ok: boolean; detail: string }>;
  remove: (profileId: string) => Promise<void>;
}

export const profilesStore = createStore<ProfilesState>((set, get) => ({
  profiles: [],
  loading: false,
  researchingId: null,
  pending: null,
  error: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const profiles = await hubClient.getProfiles();
      set({ profiles, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  matchFor: (device) => findMatchingProfile(get().profiles, toMatchInput(device)),

  research: async (device) => {
    // Cache-first gate: never research a device we already have a profile for.
    if (get().matchFor(device)) {
      log.info(`skip research — ${device.name} already has a profile`);
      return;
    }
    const apiKey = await getApiKey();
    if (!apiKey) {
      set({ error: 'Set your Anthropic API key in Settings to research devices.' });
      return;
    }
    set({ researchingId: device.id, error: null });
    try {
      const client = new ClaudeClient({ apiKey });
      const result = await client.researchDeviceProfile(toResearchInput(device));
      if (result.found) {
        set({ pending: { deviceId: device.id, deviceName: device.name, profile: result.profile } });
      } else {
        set({ error: `No control method found: ${result.reason}` });
      }
    } catch (e) {
      set({ error: `Research failed: ${String(e)}` });
    } finally {
      set({ researchingId: null });
    }
  },

  approve: async () => {
    const pending = get().pending;
    if (!pending) return;
    const res = await hubClient.saveProfile(pending.profile);
    if (res.ok === false) {
      set({ error: res.error ?? 'Hub rejected the profile' });
      return;
    }
    set({ pending: null });
    await get().refresh();
  },

  discard: () => set({ pending: null }),

  runAction: async (profileId, actionName, device) => {
    const res = await hubClient.executeProfile(profileId, actionName, {
      targetMac: device.mac ?? undefined,
      targetIp: device.ip,
    });
    // The hub returns the executor result flat: { ok, detail }. Surface its real
    // detail (e.g. "Sent Wake-on-LAN to …" or "No … responder found") instead of
    // a generic "Hub error".
    const detail = res.detail ?? res.error ?? (res.ok ? 'Done' : 'Hub error');
    return { ok: res.ok !== false, detail };
  },

  remove: async (profileId) => {
    await hubClient.deleteProfile(profileId);
    await get().refresh();
  },
}));

export function useProfiles<T>(selector: (s: ProfilesState) => T): T {
  return useStore(profilesStore, selector);
}
