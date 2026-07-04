/**
 * PS5 control: Wake-on-LAN + power/status probe.
 *
 * Protocol logic is portable; the actual UDP I/O is injected via `UdpTransport`
 * (the tablet supplies an implementation backed by react-native-udp). This keeps
 * @casacontrol/shared free of native dependencies.
 */
import { PORTS, SONY_MAC_PREFIXES } from '../constants';
import type { Ps5Power, Ps5Status } from '../types';

/** Abstract UDP transport so shared code stays platform-agnostic. */
export interface UdpTransport {
  /** Fire-and-forget datagram (used for the WoL magic packet). */
  send(data: Uint8Array, port: number, address: string): Promise<void>;
  /** Send a datagram and wait for the first reply, or reject on timeout. */
  request(
    data: Uint8Array,
    port: number,
    address: string,
    timeoutMs: number,
  ): Promise<Uint8Array>;
}

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

/** True if a MAC belongs to a known Sony OUI prefix. */
export function isSonyMac(mac: string): boolean {
  const norm = mac.toUpperCase().replace(/-/g, ':');
  return SONY_MAC_PREFIXES.some((p) => norm.startsWith(p));
}

/** Parse "AA:BB:CC:DD:EE:FF" (or dashes) into 6 bytes. */
export function macToBytes(mac: string): number[] {
  if (!MAC_RE.test(mac)) throw new Error(`Invalid MAC address: ${mac}`);
  return mac.split(/[:-]/).map((h) => parseInt(h, 16));
}

/** Build a Wake-on-LAN magic packet: 6×0xFF then the MAC repeated 16 times. */
export function buildMagicPacket(mac: string): Uint8Array {
  const macBytes = macToBytes(mac);
  const packet = new Uint8Array(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) packet.set(macBytes, 6 + i * 6);
  return packet;
}

/**
 * Parse a PS4/PS5 device-discovery ("SRCH") response.
 * The console replies with a text block whose first line encodes power state,
 * e.g. "HTTP/1.1 200 Ok" (on) or "HTTP/1.1 620 Server Standby" (rest mode),
 * plus key:value lines such as "running-app-name:...".
 */
export function parseSearchResponse(text: string): Ps5Status {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  let power: Ps5Power = 'unknown';
  if (/\b200\b/.test(firstLine)) power = 'on';
  else if (/\b620\b/.test(firstLine)) power = 'standby';

  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const idx = line.indexOf(':');
    if (idx > 0) fields[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }

  return {
    power,
    currentGame: fields['running-app-name'] ?? null,
    currentTitleId: fields['running-app-titleid'] ?? null,
  };
}

const SEARCH_PACKET = new Uint8Array([
  ...'SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n\n'
    .split('')
    .map((c) => c.charCodeAt(0)),
]);

export interface Ps5Options {
  /** MAC used for Wake-on-LAN. */
  mac: string;
  /** Console IP for status probing. */
  host: string;
  /** Broadcast address for the magic packet (e.g. 192.168.1.255). */
  broadcast?: string;
  transport: UdpTransport;
}

export class Ps5Controller {
  constructor(private readonly opts: Ps5Options) {}

  /** Power on via Wake-on-LAN magic packet (UDP broadcast, port 9). */
  async wake(): Promise<void> {
    const packet = buildMagicPacket(this.opts.mac);
    const broadcast = this.opts.broadcast ?? '255.255.255.255';
    await this.opts.transport.send(packet, PORTS.wakeOnLan, broadcast);
  }

  /** Probe power status via the device-discovery UDP protocol (port 987). */
  async getStatus(timeoutMs = 2_000): Promise<Ps5Status> {
    try {
      const reply = await this.opts.transport.request(
        SEARCH_PACKET,
        PORTS.ps5Remote,
        this.opts.host,
        timeoutMs,
      );
      const text = String.fromCharCode(...Array.from(reply));
      return parseSearchResponse(text);
    } catch {
      return { power: 'offline', currentGame: null, currentTitleId: null };
    }
  }
}
