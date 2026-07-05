/**
 * Phone-side Spotify wiring:
 *  - SecureStore-backed TokenProvider (silent auto-refresh)
 *  - singleton SpotifyClient + shared Zustand store
 *  - useSpotifyLogin() PKCE hook via expo-auth-session
 */
import { useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useStore } from 'zustand';
import { hubClient } from './connection';
import {
  SpotifyClient,
  createSpotifyStore,
  refreshAccessToken,
  isExpired,
  SPOTIFY_AUTH_DISCOVERY,
  SPOTIFY_SCOPES,
  type SpotifyState,
  type SpotifyTokens,
  type TokenProvider,
} from '@casacontrol/shared';

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '';
const TOKENS_KEY = 'spotify_tokens';
const APP_SCHEME = 'casacontrol';

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

// When the bare play button finds no Web-API device (tablet cold/locked), ask
// the hub to cold-start the tablet's local Spotify via App Remote. (No import
// cycle: connection.ts does not import this module.)
export const store = createSpotifyStore(spotifyClient, undefined, async () => {
  const res = await hubClient.sendCommand({ action: 'spotify.resumeLocal' });
  const r = res.result as { ok?: boolean } | undefined;
  return res.ok !== false && r?.ok === true;
});

// Hydrate auth flag on module load.
void loadTokens().then((t) => store.getState().setAuthed(!!t));

/** Subscribe a component to a slice of the Spotify store. */
export function useSpotifyStore<T>(selector: (s: SpotifyState) => T): T {
  return useStore(store, selector);
}

// Spotify rejects a bare `scheme://` redirect — it must include a path.
const redirectUri = AuthSession.makeRedirectUri({ scheme: APP_SCHEME, path: 'callback' });

/** PKCE login hook. Call `promptAsync()` from a button. */
export function useSpotifyLogin() {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      scopes: SPOTIFY_SCOPES,
      usePKCE: true,
      redirectUri,
    },
    SPOTIFY_AUTH_DISCOVERY,
  );

  useEffect(() => {
    if (response?.type !== 'success' || !request?.codeVerifier) return;
    const code = response.params.code;
    if (!code) return;
    AuthSession.exchangeCodeAsync(
      {
        clientId: CLIENT_ID,
        code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      },
      SPOTIFY_AUTH_DISCOVERY,
    )
      .then((res) =>
        saveTokens({
          accessToken: res.accessToken,
          refreshToken: res.refreshToken ?? '',
          expiresAt: Date.now() + (res.expiresIn ?? 3600) * 1000 - 60_000,
        }),
      )
      .then(() => store.getState().startPolling())
      .catch((e) => store.setState({ error: String(e) }));
  }, [response, request]);

  return { promptAsync, isReady: !!request, clientConfigured: CLIENT_ID.length > 0 };
}
