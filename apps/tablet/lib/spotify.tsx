/**
 * Tablet-side Spotify wiring — mirrors the phone, with the hub URL scheme.
 * The tablet mostly *displays* Now Playing but can also control playback.
 */
import { useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useStore } from 'zustand';
import {
  SpotifyClient,
  createSpotifyStore,
  refreshAccessToken,
  isExpired,
  createLogger,
  SPOTIFY_AUTH_DISCOVERY,
  SPOTIFY_SCOPES,
  type SpotifyState,
  type SpotifyTokens,
  type TokenProvider,
} from '@casacontrol/shared';
import { ENV } from './env';

WebBrowser.maybeCompleteAuthSession();

const log = createLogger('spotify');
const CLIENT_ID = ENV.spotifyClientId;
const TOKENS_KEY = 'spotify_tokens';
const APP_SCHEME = 'casacontrol-hub';

let cache: SpotifyTokens | null = null;

async function loadTokens(): Promise<SpotifyTokens | null> {
  if (cache) return cache;
  const raw = await SecureStore.getItemAsync(TOKENS_KEY);
  cache = raw ? (JSON.parse(raw) as SpotifyTokens) : null;
  return cache;
}

export async function saveTokens(tokens: SpotifyTokens): Promise<void> {
  cache = tokens;
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
  store.getState().setAuthed(true);
}

export async function logoutSpotify(): Promise<void> {
  cache = null;
  await SecureStore.deleteItemAsync(TOKENS_KEY);
  store.getState().stopPolling();
  store.getState().setAuthed(false);
}

const tokenProvider: TokenProvider = {
  async getValidAccessToken() {
    let tokens = await loadTokens();
    if (!tokens) throw new Error('Not logged in to Spotify');
    if (isExpired(tokens)) {
      tokens = await refreshAccessToken(CLIENT_ID, tokens.refreshToken);
      await saveTokens(tokens);
    }
    return tokens.accessToken;
  },
  async invalidate() {
    const tokens = await loadTokens();
    if (!tokens) return;
    const refreshed = await refreshAccessToken(CLIENT_ID, tokens.refreshToken);
    await saveTokens(refreshed);
  },
};

export const spotifyClient = new SpotifyClient(tokenProvider);
export const store = createSpotifyStore(spotifyClient);

void loadTokens().then((t) => store.getState().setAuthed(!!t));

export function useSpotifyStore<T>(selector: (s: SpotifyState) => T): T {
  return useStore(store, selector);
}

// Spotify rejects a bare `scheme://` redirect — it must include a path.
const redirectUri = AuthSession.makeRedirectUri({ scheme: APP_SCHEME, path: 'callback' });
log.info(`redirect URI = ${redirectUri} (must be registered in the Spotify dashboard)`);

export function useSpotifyLogin() {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    { clientId: CLIENT_ID, scopes: SPOTIFY_SCOPES, usePKCE: true, redirectUri },
    SPOTIFY_AUTH_DISCOVERY,
  );

  useEffect(() => {
    if (!response) return;
    log.info(`auth response: ${response.type}`);
    if (response.type === 'error') {
      log.error('auth failed', response.params);
      return;
    }
    if (response.type !== 'success' || !request?.codeVerifier) return;
    const code = response.params.code;
    if (!code) {
      log.warn('auth success but no code in params');
      return;
    }
    log.info('exchanging auth code for tokens…');
    AuthSession.exchangeCodeAsync(
      {
        clientId: CLIENT_ID,
        code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      },
      SPOTIFY_AUTH_DISCOVERY,
    )
      .then((res) => {
        log.info('token exchange OK — logged in');
        return saveTokens({
          accessToken: res.accessToken,
          refreshToken: res.refreshToken ?? '',
          expiresAt: Date.now() + (res.expiresIn ?? 3600) * 1000 - 60_000,
        });
      })
      .then(() => store.getState().startPolling())
      .catch((e) => {
        log.error('token exchange failed', String(e));
        store.setState({ error: String(e) });
      });
  }, [response, request]);

  if (!CLIENT_ID) log.warn('login unavailable: CLIENT_ID is empty in this bundle');
  return { promptAsync, isReady: !!request, clientConfigured: CLIENT_ID.length > 0 };
}
