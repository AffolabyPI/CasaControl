/**
 * Expo config plugin: flag BLUETOOTH_SCAN with `neverForLocation`.
 *
 * react-native-ble-plx's plugin declares BLUETOOTH_SCAN together with
 * ACCESS_FINE/COARSE_LOCATION. On Android 12+ that couples BLE scanning to the
 * system Location toggle: with Location OFF, scans silently return ZERO results
 * and connects fail — which is exactly what broke the UE BOOM wake.
 *
 * We only use BLE to control a known speaker (never to derive physical
 * location), so we add `android:usesPermissionFlags="neverForLocation"` to the
 * scan permission. That decouples BLE from Location Services entirely.
 *
 * Must run AFTER the react-native-ble-plx plugin (which creates the permission),
 * so it is listed later in app.json's `plugins`.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const SCAN_PERMISSION = 'android.permission.BLUETOOTH_SCAN';

module.exports = function withBleNeverForLocation(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const perms = manifest['uses-permission'] || [];
    const scan = perms.find((p) => p.$?.['android:name'] === SCAN_PERMISSION);
    if (scan) {
      scan.$['android:usesPermissionFlags'] = 'neverForLocation';
    }
    return cfg;
  });
};
