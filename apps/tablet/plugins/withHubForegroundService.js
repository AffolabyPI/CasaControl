/**
 * Expo config plugin: makes notifee's foreground service Android-14-compatible.
 *
 * On Android 14 (API 34) every foreground service must declare a
 * `foregroundServiceType` in the manifest, or the app crashes with
 * MissingForegroundServiceTypeException when the service starts. notifee's
 * `app.notifee.core.ForegroundService` ships without a type, so we merge one in.
 *
 * We use `specialUse` — an always-on local HTTP/TCP hub server that exposes
 * device controls to the companion phone app over the LAN doesn't fit any of the
 * predefined types (dataSync is time-capped on Android 15+).
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const SERVICE_NAME = 'app.notifee.core.ForegroundService';
const SUBTYPE =
  'Always-on local hub server exposing home-device controls to the companion ' +
  'phone app over the LAN; must keep running while the tablet is idle.';

module.exports = function withHubForegroundService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;

    // Ensure the tools namespace exists so we can use tools:node="merge".
    manifest.manifest.$['xmlns:tools'] =
      manifest.manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    const app = manifest.manifest.application?.[0];
    if (!app) return cfg;
    app.service = app.service || [];

    let svc = app.service.find((s) => s.$?.['android:name'] === SERVICE_NAME);
    if (!svc) {
      svc = { $: { 'android:name': SERVICE_NAME } };
      app.service.push(svc);
    }
    // notifee's core AAR declares this service as `shortService` (time-limited
    // on Android 14 — it gets killed after ~3 min, useless for an always-on
    // hub). Override it to `specialUse` with tools:replace.
    svc.$['android:foregroundServiceType'] = 'specialUse';
    svc.$['tools:replace'] = 'android:foregroundServiceType';
    svc.property = [
      {
        $: {
          'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
          'android:value': SUBTYPE,
        },
      },
    ];

    return cfg;
  });
};
