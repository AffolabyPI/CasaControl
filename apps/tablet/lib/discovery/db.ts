/**
 * SQLite persistence for discovered devices (expo-sqlite async API).
 */
import * as SQLite from 'expo-sqlite';
import type { Device, DeviceCategory, DeviceKind } from '@casacontrol/shared';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('casacontrol.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS devices (
          id        TEXT PRIMARY KEY NOT NULL,
          ip        TEXT NOT NULL,
          hostname  TEXT,
          mac       TEXT,
          kind      TEXT NOT NULL,
          category  TEXT NOT NULL,
          name      TEXT NOT NULL,
          lastSeen  INTEGER NOT NULL,
          online    INTEGER NOT NULL,
          meta      TEXT
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

interface Row {
  id: string;
  ip: string;
  hostname: string | null;
  mac: string | null;
  kind: string;
  category: string;
  name: string;
  lastSeen: number;
  online: number;
  meta: string | null;
}

function rowToDevice(r: Row): Device {
  return {
    id: r.id,
    ip: r.ip,
    hostname: r.hostname,
    mac: r.mac,
    kind: r.kind as DeviceKind,
    category: r.category as DeviceCategory,
    name: r.name,
    lastSeen: r.lastSeen,
    online: r.online === 1,
    meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : undefined,
  };
}

/** Insert or update a device, merging any existing metadata. */
export async function upsertDevice(device: Device): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO devices (id, ip, hostname, mac, kind, category, name, lastSeen, online, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ip=excluded.ip,
       hostname=COALESCE(excluded.hostname, devices.hostname),
       mac=COALESCE(excluded.mac, devices.mac),
       kind=excluded.kind,
       category=excluded.category,
       name=excluded.name,
       lastSeen=excluded.lastSeen,
       online=excluded.online,
       meta=COALESCE(excluded.meta, devices.meta);`,
    [
      device.id,
      device.ip,
      device.hostname,
      device.mac,
      device.kind,
      device.category,
      device.name,
      device.lastSeen,
      device.online ? 1 : 0,
      device.meta ? JSON.stringify(device.meta) : null,
    ],
  );
}

export async function listDevices(): Promise<Device[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM devices ORDER BY category, name;',
  );
  return rows.map(rowToDevice);
}

/** Flag devices not seen within `thresholdMs` as offline. */
export async function markStaleOffline(thresholdMs: number): Promise<void> {
  const db = await getDb();
  const cutoff = Date.now() - thresholdMs;
  await db.runAsync('UPDATE devices SET online = 0 WHERE lastSeen < ?;', [cutoff]);
}

export async function getDevice(id: string): Promise<Device | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM devices WHERE id = ?;', [id]);
  return row ? rowToDevice(row) : null;
}
