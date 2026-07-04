/**
 * Spotify Authorization Code + PKCE helpers.
 *
 * The interactive login (opening the browser, generating the PKCE verifier)
 * lives in each app via `expo-auth-session`. This module holds the portable,
 * platform-agnostic pieces: endpoints, scopes, and the token exchange/refresh
 * network calls (plain `fetch`, so they run anywhere).
 */

export const SPOTIFY_AUTH_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
} as const;

/** Scopes required for the playback controls we expose. */
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  // Search + queue + browsing your playlists:
  'playlist-read-private',
  'playlist-read-collaborative',
];

export interface SpotifyTokens {
  accessToken: string;
  /** Spotify may omit a new refresh token on refresh; keep the previous one. */
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

interface RawTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  refresh_token?: string;
  scope?: string;
}

/** Small safety margin so we refresh slightly before actual expiry. */
const EXPIRY_SKEW_MS = 60_000;

function toTokens(raw: RawTokenResponse, fallbackRefresh?: string): SpotifyTokens {
  const refreshToken = raw.refresh_token ?? fallbackRefresh;
  if (!refreshToken) {
    throw new Error('Spotify token response had no refresh token');
  }
  return {
    accessToken: raw.access_token,
    refreshToken,
    expiresAt: Date.now() + raw.expires_in * 1_000 - EXPIRY_SKEW_MS,
  };
}

/**
 * Exchange an authorization code for tokens (PKCE — no client secret).
 * Usually `expo-auth-session` does this for you, but this is here for parity
 * and for flows that hand back a raw code.
 */
export async function exchangeCodeForTokens(params: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(SPOTIFY_AUTH_DISCOVERY.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Spotify code exchange failed (${res.status}): ${await res.text()}`);
  }
  return toTokens((await res.json()) as RawTokenResponse);
}

/**
 * Silently refresh the access token using the stored refresh token.
 * Called automatically when a request finds the token expired.
 */
export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch(SPOTIFY_AUTH_DISCOVERY.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Spotify token refresh failed (${res.status}): ${await res.text()}`);
  }
  return toTokens((await res.json()) as RawTokenResponse, refreshToken);
}

export function isExpired(tokens: SpotifyTokens): boolean {
  return Date.now() >= tokens.expiresAt;
}
