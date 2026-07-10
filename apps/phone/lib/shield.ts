/**
 * Phone-side Nvidia Shield / Android TV control. Everything goes through the hub
 * (the tablet holds the paired remote connection).
 */
import type { ShieldKey, ShieldStatus } from '@casacontrol/shared';
import { hubClient } from './connection';

export type { ShieldKey, ShieldStatus };

export function fetchShieldStatus(): Promise<ShieldStatus> {
  return hubClient.getShieldStatus();
}

export function startShieldPairing(): Promise<{ ok: boolean; error?: string }> {
  return hubClient.shieldPairStart();
}

export function submitShieldCode(code: string): Promise<{ ok: boolean; error?: string }> {
  return hubClient.shieldPairCode(code);
}

export function connectShield(): Promise<{ ok: boolean; error?: string }> {
  return hubClient.shieldConnect();
}

export async function sendShieldKey(key: ShieldKey): Promise<{ ok: boolean; error?: string }> {
  const res = await hubClient.sendCommand({ action: 'shield.key', key });
  const r = res.result as { ok?: boolean; error?: string } | undefined;
  return { ok: r?.ok !== false, error: r?.error };
}
