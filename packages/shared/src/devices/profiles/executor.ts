/**
 * Generic profile executor — a pure interpreter.
 *
 * It validates a profile through the zod schema (the security boundary), resolves
 * `{PLACEHOLDER}` tokens from runtime context, and dispatches to ONE of the four
 * capability handlers. It contains NO device-specific logic: the actual BLE
 * write / Wake-on-LAN / HTTP / mDNS work is injected by the platform (the tablet
 * wires these to its existing react-native-ble-plx / react-native-udp / fetch
 * paths), exactly like ps5.ts injects its datagram sender.
 */
import { validateProfile, type ProfileAction } from './schema';

export interface ExecutionContext {
  /** The hub tablet's own Bluetooth MAC (for payloads that embed the controller). */
  pairedMac?: string;
  /** The target device's MAC. */
  targetMac?: string;
  /** The target device's IP. */
  targetIp?: string;
  /** The BLE peripheral id to connect to for ble_write. */
  bleDeviceId?: string;
}

/** Platform-provided implementations. Reuse the app's existing paths. */
export interface CapabilityHandlers {
  bleWrite(a: {
    deviceId: string;
    serviceUUID: string;
    characteristicUUID: string;
    payloadHex: string;
    withResponse: boolean;
  }): Promise<void>;
  wakeOnLan(a: { mac: string; port: number }): Promise<void>;
  httpRequest(a: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number }>;
  mdnsResolve(a: { serviceType: string }): Promise<{ ip?: string; hostname?: string } | null>;
}

export interface ExecResult {
  ok: boolean;
  detail: string;
}

const PLACEHOLDER_RE = /\{(PAIRED_MAC|TARGET_MAC|TARGET_IP)\}/g;

/** MAC in any separator form → lowercase hex digits only ("c4:7d" → "c47d"). */
export function macToHex(mac: string): string {
  return mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

/** Which placeholders a template needs but the context can't supply. */
function missingFor(template: string, ctx: ExecutionContext): string[] {
  const need = new Set((template.match(PLACEHOLDER_RE) ?? []).map((t) => t.slice(1, -1)));
  const missing: string[] = [];
  if (need.has('PAIRED_MAC') && !ctx.pairedMac) missing.push('PAIRED_MAC');
  if (need.has('TARGET_MAC') && !ctx.targetMac) missing.push('TARGET_MAC');
  if (need.has('TARGET_IP') && !ctx.targetIp) missing.push('TARGET_IP');
  return missing;
}

/** Resolve placeholders as plain strings (MACs keep their given form). */
export function resolveString(template: string, ctx: ExecutionContext): string {
  return template.replace(PLACEHOLDER_RE, (_m, name: string) => {
    if (name === 'PAIRED_MAC') return ctx.pairedMac ?? '';
    if (name === 'TARGET_MAC') return ctx.targetMac ?? '';
    return ctx.targetIp ?? '';
  });
}

/** Resolve a BLE payload template to a pure hex string (MACs become hex bytes). */
export function resolvePayloadHex(template: string, ctx: ExecutionContext): string {
  const withValues = template.replace(PLACEHOLDER_RE, (_m, name: string) => {
    if (name === 'PAIRED_MAC') return ctx.pairedMac ? macToHex(ctx.pairedMac) : '';
    if (name === 'TARGET_MAC') return ctx.targetMac ? macToHex(ctx.targetMac) : '';
    return ''; // TARGET_IP has no meaning inside a BLE payload
  });
  return withValues.replace(/[\s:-]/g, '').toLowerCase();
}

async function runAction(
  action: ProfileAction,
  ctx: ExecutionContext,
  handlers: CapabilityHandlers,
): Promise<ExecResult> {
  switch (action.capability) {
    case 'ble_write': {
      if (!ctx.bleDeviceId) return { ok: false, detail: 'No BLE device id in context' };
      const missing = missingFor(action.payloadTemplate, ctx);
      if (missing.length) return { ok: false, detail: `Missing context: ${missing.join(', ')}` };
      const payloadHex = resolvePayloadHex(action.payloadTemplate, ctx);
      if (payloadHex.length === 0 || payloadHex.length % 2 !== 0) {
        return { ok: false, detail: 'Resolved BLE payload is empty or not whole bytes' };
      }
      await handlers.bleWrite({
        deviceId: ctx.bleDeviceId,
        serviceUUID: action.serviceUUID,
        characteristicUUID: action.characteristicUUID,
        payloadHex,
        withResponse: action.writeType === 'withResponse',
      });
      return { ok: true, detail: `Wrote ${payloadHex.length / 2} bytes over BLE` };
    }
    case 'wake_on_lan': {
      const missing = missingFor(action.macTemplate, ctx);
      if (missing.length) return { ok: false, detail: `Missing context: ${missing.join(', ')}` };
      const mac = resolveString(action.macTemplate, ctx).trim();
      if (!/^[0-9a-fA-F]{2}(?:[:-][0-9a-fA-F]{2}){5}$/.test(mac)) {
        return { ok: false, detail: `Resolved MAC is invalid: "${mac}"` };
      }
      await handlers.wakeOnLan({ mac, port: action.port ?? 9 });
      return { ok: true, detail: `Sent Wake-on-LAN to ${mac}` };
    }
    case 'http_request': {
      const missing = [
        ...missingFor(action.urlTemplate, ctx),
        ...(action.bodyTemplate ? missingFor(action.bodyTemplate, ctx) : []),
      ];
      if (missing.length) return { ok: false, detail: `Missing context: ${missing.join(', ')}` };
      const url = resolveString(action.urlTemplate, ctx);
      const body = action.bodyTemplate ? resolveString(action.bodyTemplate, ctx) : undefined;
      const res = await handlers.httpRequest({
        method: action.method,
        url,
        headers: action.headers,
        body,
      });
      return { ok: res.status >= 200 && res.status < 400, detail: `HTTP ${res.status} ${url}` };
    }
    case 'mdns_resolve': {
      const found = await handlers.mdnsResolve({ serviceType: action.serviceType });
      if (!found) return { ok: false, detail: `No ${action.serviceType} responder found` };
      return { ok: true, detail: `Resolved ${found.hostname ?? ''} ${found.ip ?? ''}`.trim() };
    }
  }
}

/**
 * Validate a profile then execute one of its named actions. Throws if the
 * profile fails schema validation (the caller should have validated already, but
 * this is the last-line security gate before any handler runs).
 */
export async function executeProfileAction(
  profile: unknown,
  actionName: string,
  context: ExecutionContext,
  handlers: CapabilityHandlers,
): Promise<ExecResult> {
  const valid = validateProfile(profile); // throws on anything not schema-clean
  const action = valid.actions[actionName];
  if (!action) {
    return { ok: false, detail: `Profile "${valid.profileId}" has no action "${actionName}"` };
  }
  try {
    return await runAction(action, context, handlers);
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
