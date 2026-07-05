import { requireNativeModule } from 'expo-modules-core';

/**
 * Native partial (CPU-only) wake lock. Unlike expo-keep-awake (which keeps the
 * *screen* on), this keeps the CPU awake with the screen off/locked, so the hub
 * can finish multi-second work (BLE speaker wake, Spotify device handoff) while
 * the tablet is in private mode. The tablet is USB-powered, so the cost is nil.
 */
const Native = requireNativeModule('HubWakeLock');

export function acquireHubWakeLock(): void {
  Native.acquire();
}

export function releaseHubWakeLock(): void {
  Native.release();
}
