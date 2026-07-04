/**
 * Builds PS5 / printer controllers from config + discovered devices, and
 * exposes the actions the hub command router and REST endpoints call.
 */
import {
  Ps5Controller,
  PrinterController,
  type Ps5Status,
  type PrinterStatus,
} from '@casacontrol/shared';
import { nativeUdpTransport } from './udpTransport';
import { deviceStore } from '../discovery/store';

const PS5_MAC = process.env.EXPO_PUBLIC_PS5_MAC ?? '';
const PS5_IP = process.env.EXPO_PUBLIC_PS5_IP ?? '';
const LAN_BROADCAST = process.env.EXPO_PUBLIC_LAN_BROADCAST ?? '255.255.255.255';

function discoveredIp(kinds: string[]): string | null {
  const d = deviceStore.getState().devices.find((x) => kinds.includes(x.kind));
  return d?.ip ?? null;
}

export function getPs5Controller(): Ps5Controller | null {
  if (!PS5_MAC) return null;
  const host = discoveredIp(['ps5', 'ps4']) ?? PS5_IP;
  return new Ps5Controller({
    mac: PS5_MAC,
    host,
    broadcast: LAN_BROADCAST,
    transport: nativeUdpTransport,
  });
}

export async function ps5Wake(): Promise<{ ok: boolean; error?: string }> {
  const c = getPs5Controller();
  if (!c) return { ok: false, error: 'PS5 MAC not set (EXPO_PUBLIC_PS5_MAC)' };
  await c.wake();
  return { ok: true };
}

export async function ps5Status(): Promise<Ps5Status> {
  const c = getPs5Controller();
  if (!c) return { power: 'unknown', currentGame: null, currentTitleId: null };
  return c.getStatus();
}

export function getPrinterController(): PrinterController | null {
  const ip = discoveredIp(['printer']);
  return ip ? new PrinterController(ip) : null;
}

export async function printerStatus(): Promise<PrinterStatus> {
  const c = getPrinterController();
  if (!c) return { state: 'offline', stateMessage: 'No printer discovered', supplies: {} };
  return c.getStatus();
}
