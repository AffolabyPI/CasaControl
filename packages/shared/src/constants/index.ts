/**
 * Shared constants: theme, network ports, and socket event names.
 */

// ---------------------------------------------------------------------------
// Theme — white & gold (light) with a dark variant for the tablet hub
// ---------------------------------------------------------------------------

export const COLORS = {
  gold: '#C9A84C',
  goldSoft: '#E4CE8A',
  goldDark: '#9A7E2E',
  white: '#FFFFFF',
  offWhite: '#F7F6F2',
  ink: '#14140F', // near-black used for the tablet hub background
  inkSoft: '#1F1E17',
  muted: '#8A8778',
  online: '#4CAF50',
  offline: '#6B6B6B',
  danger: '#E5484D',
} as const;

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

/** Port the tablet's local REST/socket server listens on (Phase 3/5). */
export const HUB_SERVER_PORT = 4380;

/** Well-known service/control ports. */
export const PORTS = {
  ipp: 631, // printers (IPP over HTTP)
  ps5Remote: 987, // PS4/PS5 device-discovery protocol (DDP) — UDP power/status
  ps5Http: 9295, // PS5 second-screen HTTP (varies by firmware)
  wakeOnLan: 9, // magic packet UDP port
} as const;

/** mDNS service types we care about (Phase 3). */
export const MDNS_SERVICES = {
  printer: '_ipp._tcp',
  printerSecure: '_ipps._tcp',
  cast: '_googlecast._tcp',
  airplay: '_airplay._tcp',
  spotifyConnect: '_spotify-connect._tcp',
} as const;

/** Sony OUI (MAC address) prefixes — helps flag a PlayStation on the LAN. */
export const SONY_MAC_PREFIXES = [
  '00:04:1F',
  '00:13:15',
  '00:15:C1',
  '00:1D:0D',
  '00:1F:A7',
  '00:24:8D',
  '00:D9:D1',
  '28:0D:FC',
  '2C:CC:44',
  '5C:96:66',
  '78:C8:81',
  'A8:E3:EE',
  'BC:60:A7',
  'FC:0F:E6',
];

// ---------------------------------------------------------------------------
// Realtime sync (socket.io — Phase 1 wiring, used from Phase 2 on)
// ---------------------------------------------------------------------------

/** Events emitted between the tablet hub (server) and phone (client). */
export const SOCKET_EVENTS = {
  // hub -> phone
  playbackState: 'playback:state',
  devicesUpdate: 'devices:update',
  ps5Status: 'ps5:status',
  printerStatus: 'printer:status',
  // phone -> hub
  command: 'command', // carries a CasaAction
  requestSnapshot: 'snapshot:request',
  // meta
  ping: 'latency:ping',
  pong: 'latency:pong',
} as const;

// ---------------------------------------------------------------------------
// Polling cadences
// ---------------------------------------------------------------------------

export const SPOTIFY_POLL_MS = 5_000;
export const DEVICE_SCAN_INTERVAL_MS = 60_000;
export const IDLE_DIM_MS = 5 * 60_000; // dim tablet after 5 min idle
