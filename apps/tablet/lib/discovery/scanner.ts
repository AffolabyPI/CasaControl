/**
 * Local-network scanner for the tablet hub.
 *
 *  - mDNS/Bonjour via react-native-zeroconf (named services: printers, cast…)
 *  - ICMP ping sweep of the /24 via react-native-ping (finds silent hosts)
 *  - subnet detection via expo-network
 *
 * NOTE: React Native cannot read the OS ARP cache, so MAC addresses of *other*
 * hosts are generally unavailable. PS5 detection therefore leans on mDNS/
 * hostname heuristics; the WoL MAC is entered/confirmed by the user (Phase 4).
 */
import * as Network from 'expo-network';
import Zeroconf from 'react-native-zeroconf';
import Ping from 'react-native-ping';
import {
  DEVICE_CATEGORY_FOR_KIND,
  type Device,
  type DeviceKind,
} from '@casacontrol/shared';
import { enrichDevice } from './enrich';

const PING_TIMEOUT_MS = 400;
const PING_CONCURRENCY = 64;

/** Derive the `x.y.z` prefix of the current /24, e.g. "192.168.1". */
export async function getSubnetBase(): Promise<string | null> {
  try {
    const ip = await Network.getIpAddressAsync();
    if (!ip || ip === '0.0.0.0') return null;
    return ip.split('.').slice(0, 3).join('.');
  } catch {
    return null;
  }
}

/** Map an mDNS service type / hostname to a device kind. */
export function classifyService(serviceType: string, name: string): DeviceKind {
  const t = serviceType.toLowerCase();
  const n = name.toLowerCase();
  if (t.includes('ipp')) return 'printer';
  if (t.includes('googlecast')) return 'chromecast';
  if (t.includes('airplay')) return 'airplay';
  if (t.includes('spotify-connect')) return 'spotify';
  if (n.includes('ps5') || n.includes('playstation')) return 'ps5';
  return 'generic';
}

function kindToDevice(
  kind: DeviceKind,
  fields: { ip: string; hostname: string | null; name: string; mac: string | null },
): Device {
  return {
    id: fields.mac ?? fields.ip,
    ip: fields.ip,
    hostname: fields.hostname,
    mac: fields.mac,
    kind,
    category: DEVICE_CATEGORY_FOR_KIND[kind],
    name: fields.name,
    lastSeen: Date.now(),
    online: true,
  };
}

/** Ping every host in the /24 and return the IPs that responded. */
export async function pingSweep(base: string): Promise<string[]> {
  const alive: string[] = [];
  const hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);

  for (let i = 0; i < hosts.length; i += PING_CONCURRENCY) {
    const batch = hosts.slice(i, i + PING_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((ip) => Ping.start(ip, { timeout: PING_TIMEOUT_MS }).then(() => ip)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') alive.push(r.value);
    }
  }
  return alive;
}

interface ResolvedService {
  name: string;
  host?: string;
  addresses?: string[];
  txt?: Record<string, unknown>;
}

/**
 * One mDNS discovery pass. Android's NsdManager (which react-native-zeroconf
 * wraps) can only reliably resolve one service type at a time, so we scan the
 * requested types *sequentially* and tag each resolved device by the service
 * type that produced it — not by its display name (that was the classification
 * bug: "HP OfficeJet" never contains "ipp", so everything fell through to
 * `generic`).
 */
export async function mdnsScan(
  serviceTypes: string[],
  durationMsPerType = 1_500,
): Promise<Device[]> {
  const found = new Map<string, Device>();
  for (const type of serviceTypes) {
    await scanServiceType(type, found, durationMsPerType);
  }
  return Array.from(found.values());
}

/** Scan a single mDNS service type for `durationMs`, collecting into `found`. */
function scanServiceType(
  type: string,
  found: Map<string, Device>,
  durationMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const zc = new Zeroconf();
    const proto = type.includes('_udp') ? 'udp' : 'tcp';
    const name = type.replace(/^_/, '').replace(/\._(tcp|udp)$/, '');

    zc.on('resolved', (service: ResolvedService) => {
      const ip = service.addresses?.find((a) => a.includes('.')) ?? service.host ?? '';
      if (!ip) return;
      // Classify by the TYPE currently being scanned; fall back to name
      // heuristics (e.g. a PS5 advertising an otherwise-generic service).
      const kind = classifyService(type, service.name);
      const base = kindToDevice(kind, {
        ip,
        hostname: service.host ?? null,
        name: service.name,
        mac: null,
      });
      // Enrich with a smart name + vendor/model + suggested actions from the
      // TXT records (which carry model/friendly-name info we'd otherwise drop).
      const device = enrichDevice(base, { serviceType: type, txt: service.txt });
      found.set(device.id, device);
    });

    try {
      zc.scan(name, proto, 'local.');
    } catch {
      resolve();
      return;
    }

    setTimeout(() => {
      try {
        zc.stop();
        zc.removeDeviceListeners();
      } catch {
        /* noop */
      }
      resolve();
    }, durationMs);
  });
}
