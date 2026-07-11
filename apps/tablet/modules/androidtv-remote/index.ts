import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

/**
 * Android TV Remote v2 — native control of an Nvidia Shield / Android TV.
 *
 * Implements the reverse-engineered protocol used by the official Android TV
 * remote app and Home Assistant: a TLS pairing handshake on port 6467 (the TV
 * shows a 6-char code the user types back), then a persistent TLS control
 * channel on 6466 for power, navigation, transport, volume and app launches.
 *
 * The client certificate is generated once and persisted on the tablet; the
 * same cert must be presented for pairing and for every later connection (the
 * TV remembers it), so pairing is a one-time step per device.
 */
const Native = requireNativeModule('AndroidTvRemote');

export interface ShieldNativeStatus {
  /** 'unpaired' | 'pairing' | 'connected' | 'disconnected' */
  link: string;
  host: string | null;
  powered: boolean | null;
}

/**
 * Begin pairing with the TV at `host`. Resolves once the TV is showing its
 * 6-character code (then call `sendPairingCode`). Rejects on connection failure.
 */
export function startPairing(host: string, clientName: string): Promise<void> {
  return Native.startPairing(host, clientName);
}

/** Submit the code shown on the TV. Resolves when paired (then auto-connects). */
export function sendPairingCode(code: string): Promise<void> {
  return Native.sendPairingCode(code);
}

/** Open (or reuse) the control channel to a already-paired TV. */
export function connect(host: string): Promise<void> {
  return Native.connect(host);
}

/** Send one Android keycode as a short press (START+END). */
export function sendKey(keyCode: number): Promise<void> {
  return Native.sendKey(keyCode);
}

/** Launch an app/deep-link on the TV (e.g. an https:// or market:// app link). */
export function launchApp(appLink: string): Promise<void> {
  return Native.launchApp(appLink);
}

/** True if we've completed pairing with `host` before (persisted). */
export function isPaired(host: string): boolean {
  return Native.isPaired(host);
}

/** The most recently paired host (persisted), or null. */
export function pairedHost(): string | null {
  return Native.pairedHost() ?? null;
}

export function status(): ShieldNativeStatus {
  return Native.status();
}

export function disconnect(): void {
  Native.disconnect();
}

/** Fires on link-state changes (pairing progress, connect/disconnect, power). */
export function addStateListener(
  listener: (s: ShieldNativeStatus) => void,
): EventSubscription {
  return Native.addListener('onState', listener);
}
