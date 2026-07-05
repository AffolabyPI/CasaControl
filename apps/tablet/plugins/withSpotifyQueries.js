/**
 * Expo config plugin: declares the Spotify app in `<queries>`.
 *
 * The Spotify App Remote SDK (used by modules/spotify-remote to start playback
 * from cold while the tablet is locked) binds to the installed Spotify app. On
 * Android 11+ (package visibility) an app can't see or bind another package
 * unless it's listed in `<queries>`, so App Remote's connect silently fails
 * without this. The SDK's own AAR ships the same query, but that lives in a
 * jar-only vendored copy, so we declare it here to be safe and explicit.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const SPOTIFY_PACKAGE = 'com.spotify.music';

module.exports = function withSpotifyQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    manifest.queries = manifest.queries || [];
    // Reuse the first <queries> block (Expo creates one) or add our own.
    const queries = manifest.queries[0] || {};
    if (!manifest.queries[0]) manifest.queries.push(queries);

    queries.package = queries.package || [];
    const already = queries.package.some(
      (p) => p.$?.['android:name'] === SPOTIFY_PACKAGE,
    );
    if (!already) {
      queries.package.push({ $: { 'android:name': SPOTIFY_PACKAGE } });
    }

    return cfg;
  });
};
