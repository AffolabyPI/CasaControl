import { requireNativeModule } from 'expo-modules-core';

/**
 * Spotify App Remote — controls the tablet's *local* Spotify app directly over
 * an app-to-app binding, so playback can be started from cold even while the
 * tablet screen is off/locked (the Web API can only target a device that is
 * already registered, which it isn't when nothing has played in a while).
 *
 * Requires the Spotify app installed + Premium, and the tablet's package name +
 * signing SHA1 + redirect URI registered in the Spotify developer dashboard.
 * The first `connect` shows Spotify's auth screen once (do it while unlocked);
 * after that the token is cached and reconnecting is silent, even locked.
 */
const Native = requireNativeModule('SpotifyRemote');

/** Bind to the local Spotify app (resolves once connected). */
export function connectSpotify(clientId: string, redirectUri: string): Promise<boolean> {
  return Native.connect(clientId, redirectUri);
}

/** Connect if needed, then play a track/album/playlist/artist URI from cold. */
export function playUri(clientId: string, redirectUri: string, uri: string): Promise<boolean> {
  return Native.play(clientId, redirectUri, uri);
}

/** Resume/pause the local Spotify app (must already be connected). */
export function resumeSpotify(): Promise<boolean> {
  return Native.resume();
}

export function pauseSpotify(): Promise<boolean> {
  return Native.pause();
}

/** True while the app-remote binding is live. */
export function isSpotifyConnected(): boolean {
  return Native.isConnected();
}

/** Tear down the binding (Spotify keeps playing). */
export function disconnectSpotify(): void {
  Native.disconnect();
}
