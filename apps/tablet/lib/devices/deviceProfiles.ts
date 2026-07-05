/**
 * Tablet-side wiring for the adaptive device-profile system.
 *
 * Provides the platform pieces the shared engine needs:
 *  - a SQLite-backed ProfileStorage (the permanent cache),
 *  - CapabilityHandlers that reuse the tablet's EXISTING BLE write / Wake-on-LAN
 *    / fetch / mDNS paths (no new native code), and
 *  - a singleton profile store + an execute() helper.
 *
 * findMatchingProfile is checked before any research runs (see the hub routes),
 * so an approved profile is reused forever and Claude is never re-invoked for a
 * device we already handle.
 */
import * as SQLite from 'expo-sqlite';
import { Buffer } from 'buffer';
import {
  createProfileStore,
  executeProfileAction,
  buildMagicPacket,
  createLogger,
  PORTS,
  type CapabilityHandlers,
  type DeviceProfile,
  type ExecutionContext,
  type ProfileStorage,
  type ProfileStore,
  type DeviceMatchInput,
} from '@casacontrol/shared';
import { wakeSpeaker } from '../bleSpeaker';
import { nativeUdpTransport } from './udpTransport';

const log = createLogger('profiles');

const PAIRED_MAC = process.env.EXPO_PUBLIC_TABLET_BT_MAC ?? '';
const LAN_BROADCAST = process.env.EXPO_PUBLIC_LAN_BROADCAST ?? '255.255.255.255';

// --- SQLite storage (the permanent cache) ----------------------------------

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('casacontrol.db').then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS device_profiles (
          profileId TEXT PRIMARY KEY NOT NULL,
          json      TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

const sqliteStorage: ProfileStorage = {
  async load() {
    const db = await getDb();
    const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM device_profiles;');
    const out: DeviceProfile[] = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.json) as DeviceProfile);
      } catch {
        /* skip a corrupt row */
      }
    }
    return out;
  },
  async upsert(profile) {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO device_profiles (profileId, json, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(profileId) DO UPDATE SET json=excluded.json, updatedAt=excluded.updatedAt;`,
      [profile.profileId, JSON.stringify(profile), Date.now()],
    );
  },
  async remove(profileId) {
    const db = await getDb();
    await db.runAsync('DELETE FROM device_profiles WHERE profileId = ?;', [profileId]);
  },
};

// --- capability handlers (reuse existing paths) ----------------------------

const handlers: CapabilityHandlers = {
  async bleWrite({ deviceId, serviceUUID, characteristicUUID, payloadHex, withResponse }) {
    const base64 = Buffer.from(payloadHex, 'hex').toString('base64');
    await wakeSpeaker(deviceId, serviceUUID, characteristicUUID, base64, withResponse);
  },
  async wakeOnLan({ mac, port }) {
    const packet = buildMagicPacket(mac);
    await nativeUdpTransport.send(packet, port || PORTS.wakeOnLan, LAN_BROADCAST);
  },
  async httpRequest({ method, url, headers, body }) {
    const res = await fetch(url, { method, headers, body });
    return { status: res.status };
  },
  async mdnsResolve() {
    // mDNS resolution is handled by the discovery scanner; profiles rarely need
    // it at execution time, so this is a no-op resolver for now.
    return null;
  },
};

// --- the store + execute ----------------------------------------------------

// Builtins could be seeded here (e.g. the UE BOOM); left empty so the existing
// dedicated handlers stay authoritative and only AI profiles are cached.
const BUILTINS: DeviceProfile[] = [];

export const profileStore: ProfileStore = createProfileStore(sqliteStorage, BUILTINS);

/** A discovered device's runtime targeting info for placeholder resolution. */
export interface ExecTarget {
  targetMac?: string | null;
  targetIp?: string | null;
  bleDeviceId?: string | null;
}

/** Run one action of a stored profile against a target device. */
export async function executeProfile(
  profileId: string,
  actionName: string,
  target: ExecTarget,
): Promise<{ ok: boolean; detail: string }> {
  await profileStore.init();
  const profile = profileStore.listProfiles().find((p) => p.profileId === profileId);
  if (!profile) return { ok: false, detail: `No profile "${profileId}"` };
  const context: ExecutionContext = {
    pairedMac: PAIRED_MAC || undefined,
    targetMac: target.targetMac ?? undefined,
    targetIp: target.targetIp ?? undefined,
    bleDeviceId: target.bleDeviceId ?? undefined,
  };
  const result = await executeProfileAction(profile, actionName, context, handlers);
  log.info(`execute ${profileId}.${actionName} → ${result.ok ? 'ok' : 'fail'}: ${result.detail}`);
  return result;
}

/** Cache-first match for a discovered device (never triggers research). */
export async function matchProfileFor(device: DeviceMatchInput): Promise<DeviceProfile | null> {
  await profileStore.init();
  return profileStore.findMatchingProfile(device);
}

export async function saveProfile(profile: DeviceProfile): Promise<void> {
  await profileStore.saveProfile(profile); // validates via zod before persisting
  log.info(`saved profile ${profile.profileId} (${profile.source})`);
}

export async function listProfiles(): Promise<DeviceProfile[]> {
  await profileStore.init();
  return profileStore.listProfiles();
}

export async function deleteProfile(profileId: string): Promise<void> {
  await profileStore.deleteProfile(profileId);
  log.info(`deleted profile ${profileId}`);
}
