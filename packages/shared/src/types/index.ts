/**
 * Shared domain types for CasaControl.
 * Used by both the tablet hub and the phone remote, and by the shared API layer.
 */

// ---------------------------------------------------------------------------
// Devices (Phase 3 / 4)
// ---------------------------------------------------------------------------

/** High-level grouping used by the phone "Devices" screen. */
export type DeviceCategory = 'media' | 'printer' | 'gaming' | 'unknown';

/** Specific detected device kind. */
export type DeviceKind =
  | 'chromecast'
  | 'airplay'
  | 'printer'
  | 'ps5'
  | 'ps4'
  | 'spotify'
  | 'generic';

/**
 * A suggested thing you can do with a discovered device. `command` is set when
 * the hub can run it directly (e.g. wake a PS5); `hint` is set when it's a
 * suggestion that needs setup we don't have yet (e.g. HDMI-CEC on an Android TV).
 */
export interface DeviceAction {
  id: string;
  label: string;
  /** Ionicons name hint for the phone UI. */
  icon?: string;
  /** If present, the phone can run this via the hub /command endpoint. */
  command?: CasaAction;
  /** If present (and no command), shown as guidance rather than a live button. */
  hint?: string;
}

export interface Device {
  /** Stable id (usually the MAC, falling back to the IP). */
  id: string;
  ip: string;
  hostname: string | null;
  mac: string | null;
  kind: DeviceKind;
  category: DeviceCategory;
  /** Human-friendly label (smart name from mDNS TXT / model / hostname). */
  name: string;
  /** Manufacturer, when known (from mDNS TXT or MAC OUI). */
  vendor?: string;
  /** Model string, when known (e.g. "SHIELD Android TV", "AppleTV5,3"). */
  model?: string;
  /** Things the user can do with this device (some runnable, some suggestions). */
  suggestedActions?: DeviceAction[];
  /** Epoch milliseconds of the last successful discovery/ping. */
  lastSeen: number;
  online: boolean;
  /** Free-form, kind-specific metadata (e.g. printer ink levels, PS5 game). */
  meta?: Record<string, unknown>;
}

export const DEVICE_CATEGORY_FOR_KIND: Record<DeviceKind, DeviceCategory> = {
  chromecast: 'media',
  airplay: 'media',
  spotify: 'media',
  printer: 'printer',
  ps5: 'gaming',
  ps4: 'gaming',
  generic: 'unknown',
};

// ---------------------------------------------------------------------------
// Spotify (Phase 2)
// ---------------------------------------------------------------------------

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  album: string;
  albumArtUrl: string | null;
  durationMs: number;
  /** Spotify URI (e.g. "spotify:track:..."), used to play or queue this track. */
  uri?: string;
}

/** A playlist, album, or artist result that can be played as a context. */
export interface SpotifyPlaylist {
  id: string;
  name: string;
  /** Playlist owner / album artist / etc., for a subtitle. */
  subtitle: string;
  imageUrl: string | null;
  /** Context URI to start playback of the whole thing. */
  uri: string;
  kind: 'playlist' | 'album' | 'artist';
}

/** Results of a search query across tracks and playable contexts. */
export interface SpotifySearchResults {
  tracks: SpotifyTrack[];
  contexts: SpotifyPlaylist[];
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent: number | null;
  /** Whether Spotify allows changing this device's volume via the API. */
  supportsVolume: boolean;
}

export interface SpotifyPlaybackState {
  isPlaying: boolean;
  progressMs: number;
  volumePercent: number | null;
  track: SpotifyTrack | null;
  deviceId: string | null;
  /**
   * Whether the active device permits API volume control. Bluetooth speakers
   * and some Connect devices report `false`; the UI disables the slider then
   * (setting volume would otherwise 403 "VOLUME_CONTROL_DISALLOW").
   */
  supportsVolume: boolean;
  /** Epoch ms this snapshot was taken — lets clients interpolate progress. */
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// PS5 (Phase 4)
// ---------------------------------------------------------------------------

export type Ps5Power = 'on' | 'standby' | 'offline' | 'unknown';

export interface Ps5Status {
  power: Ps5Power;
  currentGame: string | null;
  currentTitleId: string | null;
}

// ---------------------------------------------------------------------------
// Printer (Phase 4)
// ---------------------------------------------------------------------------

export type PrinterState = 'ready' | 'busy' | 'stopped' | 'offline' | 'unknown';

export interface PrinterStatus {
  state: PrinterState;
  stateMessage: string | null;
  /** Marker name -> percent (0-100), when the printer reports supply levels. */
  supplies: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Govee lights (cloud API)
// ---------------------------------------------------------------------------

/** A Govee device from the account, with the controls it advertises. */
export interface GoveeDevice {
  /** Product model, e.g. "H6630". Required on every control call. */
  sku: string;
  /** Per-device id (a MAC-like string). Required on every control call. */
  device: string;
  name: string;
  type: string;
  capabilities: {
    power: boolean;
    brightness: boolean;
    colorRgb: boolean;
    colorTemp: boolean;
    scenes: boolean;
  };
}

/** A selectable dynamic scene on a Govee light. */
export interface GoveeScene {
  name: string;
  id: number;
  paramId: number;
}

/** Best-effort current state of a Govee light. */
export interface GoveeLightState {
  online: boolean;
  /** null when the device didn't report it. */
  on: boolean | null;
  /** 0-100, or null when unknown. */
  brightness: number | null;
  /** Packed RGB integer, or null when unknown. */
  colorRgb: number | null;
}

// ---------------------------------------------------------------------------
// Nvidia Shield / Android TV (native remote)
// ---------------------------------------------------------------------------

/** Connection state of the tablet's Android TV Remote link to the Shield. */
export type ShieldLinkState = 'unpaired' | 'pairing' | 'connected' | 'disconnected';

export interface ShieldStatus {
  link: ShieldLinkState;
  /** Host the remote is (or would be) pointed at. */
  host: string | null;
  /** Reported on/off power state once connected, when known. */
  powered: boolean | null;
  /** Foreground app package once connected, when known. */
  currentApp: string | null;
}

/** Remote keys the phone can send to the Shield (mapped to Android keycodes). */
export type ShieldKey =
  | 'power'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'center'
  | 'back'
  | 'home'
  | 'menu'
  | 'play_pause'
  | 'rewind'
  | 'fast_forward'
  | 'volume_up'
  | 'volume_down'
  | 'mute';

// ---------------------------------------------------------------------------
// Assistant actions (Bonus — Claude intent mapping)
// ---------------------------------------------------------------------------

export type CasaAction =
  | { action: 'spotify.play' }
  | { action: 'spotify.pause' }
  | { action: 'spotify.next' }
  | { action: 'spotify.previous' }
  | { action: 'spotify.setVolume'; volume: number }
  | { action: 'spotify.transfer'; deviceId: string }
  /** Start playback of a track/playlist/album URI on the tablet (from nothing). */
  | { action: 'spotify.playContext'; uri: string }
  /** Start playback of an explicit ordered track list — used to blend a playlist
   * with recommended songs. Cold-starts the tablet with the first track. */
  | { action: 'spotify.playUris'; uris: string[] }
  /** Add a track URI to the play queue. */
  | { action: 'spotify.queue'; uri: string }
  /** Resume the tablet's LOCAL Spotify via App Remote — cold-starts playback
   * while the tablet is locked, when the Web API has no available device. */
  | { action: 'spotify.resumeLocal' }
  /** Set the tablet's own media volume (0–100) — controls the Bluetooth
   * speaker (e.g. UE BOOM) when Spotify's API won't. */
  | { action: 'system.setVolume'; volume: number }
  /** Power the Bluetooth speaker (UE BOOM) on / off over BLE. */
  | { action: 'speaker.wake' }
  | { action: 'speaker.sleep' }
  | { action: 'ps5.wake' }
  | { action: 'ps5.status' }
  | { action: 'printer.print'; deviceId?: string }
  | { action: 'devices.list'; category?: DeviceCategory }
  /** Govee light — sku/device default to the hub's primary light when omitted. */
  | { action: 'govee.power'; on: boolean; sku?: string; device?: string }
  | { action: 'govee.brightness'; value: number; sku?: string; device?: string }
  /** Set colour from a packed RGB integer. */
  | { action: 'govee.color'; rgb: number; sku?: string; device?: string }
  | { action: 'govee.colorTemp'; kelvin: number; sku?: string; device?: string }
  | { action: 'govee.scene'; sceneId: number; paramId: number; sku?: string; device?: string }
  /** Send one remote key to the Nvidia Shield / Android TV. */
  | { action: 'shield.key'; key: ShieldKey }
  /** Launch an app on the Shield by package name (or a deep-link URI). */
  | { action: 'shield.launch'; target: string }
  | { action: 'unknown'; reason: string };

/** Every action string, useful for building the assistant system prompt. */
export type CasaActionName = CasaAction['action'];
