/**
 * Bluetooth Low Energy control for the UE BOOM speaker.
 *
 * UE speakers keep a BLE beacon alive even when "off" so the UE app can power
 * them on with a GATT write. We replicate that on the tablet. The exact
 * service/characteristic/value is model-specific, so this module first supports
 * DISCOVERY (scan + enumerate GATT); once we know the wake command, wakeSpeaker()
 * writes it.
 */
import { BleManager, State, type Device } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform, type Permission } from 'react-native';
import { Buffer } from 'buffer';
import { createLogger } from '@casacontrol/shared';

const log = createLogger('ble');

let manager: BleManager | null = null;
function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

async function ensurePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ].filter((p): p is Permission => p != null);
  try {
    const res = await PermissionsAndroid.requestMultiple(wanted);
    return wanted.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch (e) {
    log.error('BT permission request failed', String(e));
    return false;
  }
}

const NAME_HINTS = ['ue ', 'ueboom', 'boom', 'mega', 'wonder', 'blast', 'roll', 'logitech'];
function looksLikeUe(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return NAME_HINTS.some((h) => n.includes(h.trim()));
}

export interface ScanHit {
  id: string;
  name: string | null;
  localName: string | null;
  rssi: number | null;
  serviceUUIDs: string[] | null;
  manufacturerData: string | null;
  ueLike: boolean;
}

export interface GattTree {
  deviceId: string;
  name: string | null;
  services: {
    uuid: string;
    characteristics: {
      uuid: string;
      writableWithResponse: boolean;
      writableWithoutResponse: boolean;
      readable: boolean;
      notifiable: boolean;
    }[];
  }[];
}

async function waitForPoweredOn(): Promise<void> {
  const mgr = getManager();
  const state = await mgr.state();
  if (state !== State.PoweredOn) {
    throw new Error(`Bluetooth is ${state} — turn Bluetooth on to use the speaker.`);
  }
}

/** Scan for `durationMs` and return every device seen (so the speaker can be spotted by any name). */
export async function scanForDevices(durationMs = 8000): Promise<ScanHit[]> {
  if (!(await ensurePermissions())) throw new Error('Bluetooth permission denied');
  await waitForPoweredOn();
  const mgr = getManager();
  const seen = new Map<string, ScanHit>();
  return new Promise<ScanHit[]>((resolve, reject) => {
    mgr.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        mgr.stopDeviceScan();
        reject(error);
        return;
      }
      if (!device) return;
      seen.set(device.id, {
        id: device.id,
        name: device.name,
        localName: device.localName,
        rssi: device.rssi,
        serviceUUIDs: device.serviceUUIDs,
        manufacturerData: device.manufacturerData,
        ueLike: looksLikeUe(device.name) || looksLikeUe(device.localName),
      });
    });
    setTimeout(() => {
      mgr.stopDeviceScan();
      const hits = Array.from(seen.values());
      const ue = hits.filter((h) => h.ueLike).map((h) => h.name || h.localName);
      log.info(`scan: ${hits.length} devices, UE-like: ${ue.join(', ') || 'none'}`);
      resolve(hits);
    }, durationMs);
  });
}

/** Connect and enumerate the full GATT tree — the map we use to find the wake write. */
export async function inspectDevice(deviceId: string): Promise<GattTree> {
  if (!(await ensurePermissions())) throw new Error('Bluetooth permission denied');
  const mgr = getManager();
  let dev: Device | null = null;
  try {
    dev = await mgr.connectToDevice(deviceId, { timeout: 10000 });
    await dev.discoverAllServicesAndCharacteristics();
    const services = await dev.services();
    const tree: GattTree = { deviceId, name: dev.name, services: [] };
    for (const s of services) {
      const chars = await s.characteristics();
      tree.services.push({
        uuid: s.uuid,
        characteristics: chars.map((c) => ({
          uuid: c.uuid,
          writableWithResponse: c.isWritableWithResponse,
          writableWithoutResponse: c.isWritableWithoutResponse,
          readable: c.isReadable,
          notifiable: c.isNotifiable,
        })),
      });
    }
    log.info(`inspect ${deviceId}: ${tree.services.length} services`);
    return tree;
  } finally {
    if (dev) {
      try {
        await mgr.cancelDeviceConnection(deviceId);
      } catch {
        /* noop */
      }
    }
  }
}

/** Discovery: scan, pick a UE-like device, and enumerate its GATT. */
export async function discoverSpeaker(): Promise<{ scan: ScanHit[]; inspected: GattTree | null }> {
  const scan = await scanForDevices();
  const ue = scan.find((h) => h.ueLike);
  const inspected = ue ? await inspectDevice(ue.id) : null;
  return { scan, inspected };
}

/**
 * UE BOOM power control, verified via `/ble/discover` and live GATT writes.
 * UE's control service `61fe` exposes a power characteristic (`c6d6dc0d…`,
 * write-with-response). The power command is a **7-byte** write: the 6-byte MAC
 * of a device the BOOM is ALREADY PAIRED with (normal byte order), followed by
 * 0x01 (on) / 0x02 (off). A 1-byte write is rejected with GATT_INVALID_ATTR_LEN
 * (0x0D). We use the tablet's own Bluetooth MAC, which is bonded to the speaker.
 * Ref: kancelott/ue-boom-2-bt-le-reverse-engineering.
 *
 * Configure for YOUR hardware via env (see .env.example):
 *  - EXPO_PUBLIC_UE_BOOM_MAC   — your speaker's BLE id (from `/ble/discover`)
 *  - EXPO_PUBLIC_TABLET_BT_MAC — the tablet's Bluetooth MAC, paired to the BOOM
 */
const TABLET_BT_MAC = process.env.EXPO_PUBLIC_TABLET_BT_MAC ?? '';
const UE_BOOM_MAC = process.env.EXPO_PUBLIC_UE_BOOM_MAC ?? '';

/** Build the base64 power payload `<MAC bytes><cmd>` for the UE power characteristic. */
function powerPayload(mac: string, cmd: number): string {
  const macBytes = mac.split(':').map((h) => parseInt(h, 16));
  return Buffer.from([...macBytes, cmd]).toString('base64');
}

export const UE_BOOM = {
  deviceId: UE_BOOM_MAC,
  serviceUUID: '000061fe-0000-1000-8000-00805f9b34fb',
  powerChar: 'c6d6dc0d-07f5-47ef-9b59-630622b01fd3',
  onValue: powerPayload(TABLET_BT_MAC, 0x01),
  offValue: powerPayload(TABLET_BT_MAC, 0x02),
} as const;

function assertConfigured(): void {
  if (!UE_BOOM_MAC || !TABLET_BT_MAC) {
    throw new Error(
      'Speaker not configured — set EXPO_PUBLIC_UE_BOOM_MAC and EXPO_PUBLIC_TABLET_BT_MAC in .env ' +
        '(find the speaker id via GET /ble/discover).',
    );
  }
}

/** Power the UE BOOM on over BLE. */
export function wakeUeBoom(): Promise<void> {
  assertConfigured();
  return wakeSpeaker(UE_BOOM.deviceId, UE_BOOM.serviceUUID, UE_BOOM.powerChar, UE_BOOM.onValue);
}

/** Power the UE BOOM off over BLE. */
export function sleepUeBoom(): Promise<void> {
  assertConfigured();
  return wakeSpeaker(UE_BOOM.deviceId, UE_BOOM.serviceUUID, UE_BOOM.powerChar, UE_BOOM.offValue);
}

/**
 * Power/wake a speaker by writing a value to a characteristic. The exact
 * serviceUUID/charUUID/value come from discovery for the user's UE BOOM model.
 */
export async function wakeSpeaker(
  deviceId: string,
  serviceUUID: string,
  charUUID: string,
  base64Value: string,
  withResponse = true,
): Promise<void> {
  if (!(await ensurePermissions())) throw new Error('Bluetooth permission denied');
  const mgr = getManager();
  try {
    const dev = await mgr.connectToDevice(deviceId, { timeout: 10000 });
    await dev.discoverAllServicesAndCharacteristics();
    if (withResponse) {
      await dev.writeCharacteristicWithResponseForService(serviceUUID, charUUID, base64Value);
    } else {
      await dev.writeCharacteristicWithoutResponseForService(serviceUUID, charUUID, base64Value);
    }
    log.info(`wake write sent to ${deviceId} (${serviceUUID}/${charUUID})`);
  } finally {
    try {
      await mgr.cancelDeviceConnection(deviceId);
    } catch {
      /* noop */
    }
  }
}
