/**
 * Spotify Web API client — thin, typed wrapper over the player endpoints.
 * Token management is injected via a `TokenProvider` so the same client works
 * on the phone and the tablet with their own SecureStore-backed storage.
 */
import type {
  SpotifyDevice,
  SpotifyPlaybackState,
  SpotifyPlaylist,
  SpotifySearchResults,
  SpotifyTrack,
} from '../types';

const API_BASE = 'https://api.spotify.com/v1';

export interface TokenProvider {
  /** Returns a currently-valid access token, refreshing silently if needed. */
  getValidAccessToken(): Promise<string>;
  /** Called when the API reports the token is unusable (401). */
  invalidate(): Promise<void>;
}

export class SpotifyAuthError extends Error {}
export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// --- Raw Spotify shapes (only the fields we read) --------------------------

interface RawArtist {
  name: string;
}
interface RawImage {
  url: string;
  width: number | null;
  height: number | null;
}
interface RawTrack {
  id: string;
  name: string;
  duration_ms: number;
  uri: string;
  artists: RawArtist[];
  album: { name: string; images: RawImage[] };
}
interface RawPlaylistObj {
  id: string;
  name: string;
  uri: string;
  images?: RawImage[];
  owner?: { display_name?: string };
}
interface RawAlbumObj {
  id: string;
  name: string;
  uri: string;
  images?: RawImage[];
  artists?: RawArtist[];
}
interface RawSearch {
  tracks?: { items: (RawTrack | null)[] };
  playlists?: { items: (RawPlaylistObj | null)[] };
  albums?: { items: (RawAlbumObj | null)[] };
}
interface RawPlayer {
  is_playing: boolean;
  progress_ms: number | null;
  device: {
    id: string | null;
    volume_percent: number | null;
    supports_volume?: boolean;
  } | null;
  item: RawTrack | null;
}
interface RawDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
  supports_volume?: boolean;
}

function mapTrack(item: RawTrack | null): SpotifyTrack | null {
  if (!item) return null;
  const art = item.album?.images?.[0]?.url ?? null;
  return {
    id: item.id,
    name: item.name,
    artists: item.artists.map((a) => a.name),
    album: item.album?.name ?? '',
    albumArtUrl: art,
    durationMs: item.duration_ms,
    uri: item.uri,
  };
}

function mapPlaylistObj(p: RawPlaylistObj): SpotifyPlaylist {
  return {
    id: p.id,
    name: p.name,
    subtitle: p.owner?.display_name ? `Playlist · ${p.owner.display_name}` : 'Playlist',
    imageUrl: p.images?.[0]?.url ?? null,
    uri: p.uri,
    kind: 'playlist',
  };
}

function mapAlbumObj(a: RawAlbumObj): SpotifyPlaylist {
  return {
    id: a.id,
    name: a.name,
    subtitle: a.artists?.length ? `Album · ${a.artists.map((x) => x.name).join(', ')}` : 'Album',
    imageUrl: a.images?.[0]?.url ?? null,
    uri: a.uri,
    kind: 'album',
  };
}

export class SpotifyClient {
  constructor(private readonly tokens: TokenProvider) {}

  private async request<T>(
    path: string,
    init: RequestInit = {},
    { retryOn401 = true, expectJson = false } = {},
  ): Promise<{ status: number; data: T | null }> {
    const token = await this.tokens.getValidAccessToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 401 && retryOn401) {
      await this.tokens.invalidate();
      return this.request<T>(path, init, { retryOn401: false, expectJson });
    }
    if (res.status === 401) {
      throw new SpotifyAuthError('Spotify authorization expired');
    }
    // 204 (nothing playing) / 202 (accepted) have no body.
    if (res.status === 204 || res.status === 202) {
      return { status: res.status, data: null };
    }
    if (!res.ok) {
      throw new SpotifyApiError(
        `Spotify API ${res.status}: ${await res.text()}`,
        res.status,
      );
    }
    const text = await res.text();
    if (!text) return { status: res.status, data: null };
    try {
      return { status: res.status, data: JSON.parse(text) as T };
    } catch {
      // Playback WRITE commands (play/pause/next/previous/seek/volume) normally
      // return 204, but when they target a REMOTE Connect device Spotify answers
      // 200 with a short opaque command-ack token (not JSON). We never use that
      // body, so ignore it. Only endpoints that need data pass expectJson:true —
      // for them a non-JSON body is a real error worth surfacing.
      if (!expectJson) {
        return { status: res.status, data: null };
      }
      throw new SpotifyApiError(
        `Spotify ${path} returned a non-JSON response (${res.status}): "${text
          .slice(0, 40)
          .replace(/\s+/g, ' ')}"`,
        res.status,
      );
    }
  }

  /** Full player state: track, art, progress, volume, active device. */
  async getPlaybackState(): Promise<SpotifyPlaybackState> {
    const { data } = await this.request<RawPlayer>('/me/player', {}, { expectJson: true });
    if (!data) {
      return {
        isPlaying: false,
        progressMs: 0,
        volumePercent: null,
        track: null,
        deviceId: null,
        supportsVolume: false,
        fetchedAt: Date.now(),
      };
    }
    return {
      isPlaying: data.is_playing,
      progressMs: data.progress_ms ?? 0,
      volumePercent: data.device?.volume_percent ?? null,
      track: mapTrack(data.item),
      deviceId: data.device?.id ?? null,
      // Absent field → assume supported (older clients); explicit false disables.
      supportsVolume: data.device?.supports_volume ?? true,
      fetchedAt: Date.now(),
    };
  }

  async play(): Promise<void> {
    await this.request('/me/player/play', { method: 'PUT' });
  }

  async pause(): Promise<void> {
    await this.request('/me/player/pause', { method: 'PUT' });
  }

  async next(): Promise<void> {
    await this.request('/me/player/next', { method: 'POST' });
  }

  async previous(): Promise<void> {
    await this.request('/me/player/previous', { method: 'POST' });
  }

  /** Jump to a position within the current track. Clamped to >= 0. */
  async seek(positionMs: number): Promise<void> {
    const pos = Math.max(0, Math.round(positionMs));
    await this.request(`/me/player/seek?position_ms=${pos}`, { method: 'PUT' });
  }

  /** Restart the current track from the beginning. */
  async restart(): Promise<void> {
    await this.seek(0);
  }

  /** Volume 0–100. Clamped defensively. */
  async setVolume(percent: number): Promise<void> {
    const v = Math.max(0, Math.min(100, Math.round(percent)));
    try {
      await this.request(`/me/player/volume?volume_percent=${v}`, { method: 'PUT' });
    } catch (e) {
      // Bluetooth speakers / some Connect devices reject volume with a 403
      // "VOLUME_CONTROL_DISALLOW". Surface a clear message instead of the raw body.
      if (e instanceof SpotifyApiError && e.status === 403) {
        throw new SpotifyApiError(
          "This device doesn't allow volume control from Spotify — adjust it on the speaker instead.",
          403,
        );
      }
      throw e;
    }
  }

  async getDevices(): Promise<SpotifyDevice[]> {
    const { data } = await this.request<{ devices: RawDevice[] }>(
      '/me/player/devices',
      {},
      { expectJson: true },
    );
    return (data?.devices ?? []).map((d) => ({
      id: d.id ?? '',
      name: d.name,
      type: d.type,
      isActive: d.is_active,
      volumePercent: d.volume_percent,
      supportsVolume: d.supports_volume ?? true,
    }));
  }

  /** Move playback to another Connect device (e.g. from phone to a speaker). */
  async transferPlayback(deviceId: string, play = true): Promise<void> {
    await this.request('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [deviceId], play }),
    });
  }

  /** Search tracks + playable contexts (playlists, albums). */
  async search(query: string, limit = 8): Promise<SpotifySearchResults> {
    const q = query.trim();
    if (!q) return { tracks: [], contexts: [] };
    const { data } = await this.request<RawSearch>(
      `/search?q=${encodeURIComponent(q)}&type=track,playlist,album&limit=${limit}`,
      {},
      { expectJson: true },
    );
    const tracks = (data?.tracks?.items ?? [])
      .map(mapTrack)
      .filter((t): t is SpotifyTrack => t !== null);
    // Spotify occasionally returns null items in playlist/album lists.
    const playlists = (data?.playlists?.items ?? [])
      .filter((p): p is RawPlaylistObj => !!p)
      .map(mapPlaylistObj);
    const albums = (data?.albums?.items ?? [])
      .filter((a): a is RawAlbumObj => !!a)
      .map(mapAlbumObj);
    return { tracks, contexts: [...playlists, ...albums] };
  }

  /** The user's own playlists. */
  async getMyPlaylists(limit = 50): Promise<SpotifyPlaylist[]> {
    const { data } = await this.request<{ items: (RawPlaylistObj | null)[] }>(
      `/me/playlists?limit=${limit}`,
      {},
      { expectJson: true },
    );
    return (data?.items ?? [])
      .filter((p): p is RawPlaylistObj => !!p)
      .map(mapPlaylistObj);
  }

  /**
   * START playback of specific tracks or a context (playlist/album), optionally
   * on a specific device. Unlike `play()` (which only resumes), this begins new
   * playback even when nothing was playing — the way to start music from scratch.
   */
  async startPlayback(opts: {
    uris?: string[];
    contextUri?: string;
    deviceId?: string;
  }): Promise<void> {
    const query = opts.deviceId ? `?device_id=${encodeURIComponent(opts.deviceId)}` : '';
    const body: Record<string, unknown> = {};
    if (opts.uris?.length) body.uris = opts.uris;
    if (opts.contextUri) body.context_uri = opts.contextUri;
    await this.request(`/me/player/play${query}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  /** Add a track to the end of the play queue. */
  async addToQueue(uri: string, deviceId?: string): Promise<void> {
    const params = new URLSearchParams({ uri });
    if (deviceId) params.set('device_id', deviceId);
    await this.request(`/me/player/queue?${params.toString()}`, { method: 'POST' });
  }
}
