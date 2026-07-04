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

export interface Device {
  /** Stable id (usually the MAC, falling back to the IP). */
  id: string;
  ip: string;
  hostname: string | null;
  mac: string | null;
  kind: DeviceKind;
  category: DeviceCategory;
  /** Human-friendly label (mDNS service name or hostname). */
  name: string;
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
  /** Add a track URI to the play queue. */
  | { action: 'spotify.queue'; uri: string }
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
  | { action: 'unknown'; reason: string };

/** Every action string, useful for building the assistant system prompt. */
export type CasaActionName = CasaAction['action'];
