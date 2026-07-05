/**
 * Profile store — THE CACHE that enforces "generate once, reuse forever".
 *
 * `findMatchingProfile` is the gate the discovery/research flow calls FIRST. If
 * it returns a profile (builtin or a previously-approved ai_generated one), the
 * device gets live controls with zero Claude calls. Research only ever runs when
 * this returns null, so a second identical device — or the same one after a
 * restart — reuses the cached profile and never triggers new API usage.
 *
 * Matching logic is pure + testable here; persistence is injected so the tablet
 * can back it with its existing SQLite storage while shared stays platform-free.
 */
import { validateProfile, type DeviceProfile } from './schema';

/** The subset of a discovered device used for matching. */
export interface DeviceMatchInput {
  name?: string | null;
  mac?: string | null;
  /** BLE service UUIDs the device advertises. */
  bleServiceUUIDs?: string[];
  /** mDNS service types the device was found under. */
  mdnsServiceTypes?: string[];
}

/** Injected persistence. The tablet implements this over SQLite. */
export interface ProfileStorage {
  load(): Promise<DeviceProfile[]>;
  upsert(profile: DeviceProfile): Promise<void>;
  remove(profileId: string): Promise<void>;
}

// --- pure matching ---------------------------------------------------------

/** Glob (`*` only) → anchored, case-insensitive RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

const hexOnly = (s: string): string => s.replace(/[^0-9a-fA-F]/g, '').toLowerCase();

/** Reduce a full base BLE UUID to its short (16/32-bit) form for comparison. */
function normalizeUuid(u: string): string {
  const s = u.toLowerCase();
  const m16 = s.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/);
  if (m16?.[1]) return m16[1];
  const m32 = s.match(/^([0-9a-f]{8})-0000-1000-8000-00805f9b34fb$/);
  if (m32?.[1]) return m32[1];
  return s;
}

function nameMatches(patterns: string[] | undefined, name: string | null | undefined): boolean {
  if (!patterns || !name) return false;
  return patterns.some((p) => globToRegExp(p).test(name));
}

function ouiMatches(prefixes: string[] | undefined, mac: string | null | undefined): boolean {
  if (!prefixes || !mac) return false;
  const norm = hexOnly(mac);
  return prefixes.some((p) => {
    const ph = hexOnly(p);
    return ph.length > 0 && norm.startsWith(ph);
  });
}

function uuidMatches(profileUuids: string[] | undefined, deviceUuids: string[] | undefined): boolean {
  if (!profileUuids?.length || !deviceUuids?.length) return false;
  const dev = new Set(deviceUuids.map(normalizeUuid));
  return profileUuids.some((u) => dev.has(normalizeUuid(u)));
}

function typeMatches(profileTypes: string[] | undefined, deviceTypes: string[] | undefined): boolean {
  if (!profileTypes?.length || !deviceTypes?.length) return false;
  const dev = new Set(deviceTypes.map((t) => t.toLowerCase()));
  return profileTypes.some((t) => dev.has(t.toLowerCase()));
}

/** Does this profile's hints match the discovered device? (ANY hint suffices.) */
export function profileMatches(profile: DeviceProfile, device: DeviceMatchInput): boolean {
  const h = profile.matchHints;
  return (
    nameMatches(h.namePatterns, device.name) ||
    ouiMatches(h.macOuiPrefixes, device.mac) ||
    uuidMatches(h.bleServiceUUIDs, device.bleServiceUUIDs) ||
    typeMatches(h.mdnsServiceTypes, device.mdnsServiceTypes)
  );
}

/**
 * The authoritative lookup. Returns the best matching profile, preferring
 * builtin over ai_generated, then higher confidence, then newer. Returns null
 * when nothing matches — the ONLY condition under which research should run.
 */
export function findMatchingProfile(
  profiles: DeviceProfile[],
  device: DeviceMatchInput,
): DeviceProfile | null {
  const matches = profiles.filter((p) => profileMatches(p, device));
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1; // builtin wins
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.createdAt - a.createdAt;
  });
  return matches[0] ?? null;
}

// --- the store -------------------------------------------------------------

export interface ProfileStore {
  init(): Promise<void>;
  /** Validate + persist an approved profile permanently, and cache it. */
  saveProfile(profile: DeviceProfile): Promise<void>;
  /** Cache-first lookup — the gate before any research. */
  findMatchingProfile(device: DeviceMatchInput): Promise<DeviceProfile | null>;
  listProfiles(): DeviceProfile[];
  deleteProfile(profileId: string): Promise<void>;
  updateProfile(profileId: string, patch: Partial<DeviceProfile>): Promise<void>;
}

/**
 * Create a profile store over injected storage. `builtins` are always present,
 * always win ties, and are never persisted/deleted.
 */
export function createProfileStore(
  storage: ProfileStorage,
  builtins: DeviceProfile[] = [],
): ProfileStore {
  let persisted: DeviceProfile[] = [];
  let loaded = false;

  const all = (): DeviceProfile[] => [...builtins, ...persisted];

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    persisted = await storage.load();
    loaded = true;
  }

  return {
    async init() {
      await ensureLoaded();
    },

    async saveProfile(profile) {
      validateProfile(profile); // never persist anything that isn't schema-clean
      await ensureLoaded();
      await storage.upsert(profile);
      persisted = [...persisted.filter((p) => p.profileId !== profile.profileId), profile];
    },

    async findMatchingProfile(device) {
      await ensureLoaded();
      return findMatchingProfile(all(), device);
    },

    listProfiles() {
      return all();
    },

    async deleteProfile(profileId) {
      await ensureLoaded();
      // Builtins are read-only; only persisted (ai_generated) profiles delete.
      await storage.remove(profileId);
      persisted = persisted.filter((p) => p.profileId !== profileId);
    },

    async updateProfile(profileId, patch) {
      await ensureLoaded();
      const existing = persisted.find((p) => p.profileId === profileId);
      if (!existing) throw new Error(`No editable profile "${profileId}"`);
      const next = validateProfile({ ...existing, ...patch, profileId });
      await storage.upsert(next);
      persisted = persisted.map((p) => (p.profileId === profileId ? next : p));
    },
  };
}
