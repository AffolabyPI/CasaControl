import { describe, it, expect, vi } from 'vitest';
import {
  executeProfileAction,
  resolvePayloadHex,
  resolveString,
  macToHex,
  type CapabilityHandlers,
  type ExecutionContext,
} from './executor';
import type { DeviceProfile } from './schema';

function handlers(overrides: Partial<CapabilityHandlers> = {}): CapabilityHandlers {
  return {
    bleWrite: vi.fn(async () => {}),
    wakeOnLan: vi.fn(async () => {}),
    httpRequest: vi.fn(async () => ({ status: 200 })),
    mdnsResolve: vi.fn(async () => ({ ip: '10.0.0.5', hostname: 'x.local' })),
    ...overrides,
  };
}

const bleProfile: DeviceProfile = {
  profileId: 'spk',
  deviceName: 'Some Speaker',
  matchHints: { namePatterns: ['Some*'] },
  actions: {
    power_on: {
      capability: 'ble_write',
      serviceUUID: '0000fe00-0000-1000-8000-00805f9b34fb',
      characteristicUUID: '0000fe01-0000-1000-8000-00805f9b34fb',
      payloadTemplate: '01 {PAIRED_MAC} ff',
      writeType: 'withoutResponse',
    },
  },
  source: 'ai_generated',
  confidence: 0.6,
  createdAt: 1,
  citations: ['https://example.com/a'],
};

describe('placeholder resolution', () => {
  it('macToHex strips separators and lowercases', () => {
    expect(macToHex('C4:7D:9F:8D:B7:F0')).toBe('c47d9f8db7f0');
  });

  it('resolvePayloadHex embeds the MAC as hex bytes and strips separators', () => {
    const hex = resolvePayloadHex('01 {PAIRED_MAC} ff', { pairedMac: 'C4:7D:9F:8D:B7:F0' });
    expect(hex).toBe('01c47d9f8db7f0ff');
  });

  it('resolveString keeps MAC form and fills TARGET_IP', () => {
    expect(resolveString('http://{TARGET_IP}/x', { targetIp: '10.0.0.9' })).toBe('http://10.0.0.9/x');
    expect(resolveString('{TARGET_MAC}', { targetMac: 'AA:BB:CC:DD:EE:FF' })).toBe('AA:BB:CC:DD:EE:FF');
  });
});

describe('executeProfileAction', () => {
  it('dispatches ble_write with the resolved payload', async () => {
    const h = handlers();
    const ctx: ExecutionContext = { pairedMac: 'C4:7D:9F:8D:B7:F0', bleDeviceId: 'DEV-1' };
    const r = await executeProfileAction(bleProfile, 'power_on', ctx, h);
    expect(r.ok).toBe(true);
    expect(h.bleWrite).toHaveBeenCalledWith({
      deviceId: 'DEV-1',
      serviceUUID: '0000fe00-0000-1000-8000-00805f9b34fb',
      characteristicUUID: '0000fe01-0000-1000-8000-00805f9b34fb',
      payloadHex: '01c47d9f8db7f0ff',
      withResponse: false,
    });
  });

  it('fails ble_write when required context is missing', async () => {
    const h = handlers();
    const r = await executeProfileAction(bleProfile, 'power_on', { bleDeviceId: 'DEV-1' }, h);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/PAIRED_MAC/);
    expect(h.bleWrite).not.toHaveBeenCalled();
  });

  it('fails ble_write when no BLE device id is provided', async () => {
    const h = handlers();
    const r = await executeProfileAction(bleProfile, 'power_on', { pairedMac: 'C4:7D:9F:8D:B7:F0' }, h);
    expect(r.ok).toBe(false);
    expect(h.bleWrite).not.toHaveBeenCalled();
  });

  it('dispatches wake_on_lan with resolved MAC + default port', async () => {
    const h = handlers();
    const profile: DeviceProfile = {
      ...bleProfile,
      actions: { wake: { capability: 'wake_on_lan', macTemplate: '{TARGET_MAC}' } },
    };
    const r = await executeProfileAction(profile, 'wake', { targetMac: '80:60:B7:2B:B9:06' }, h);
    expect(r.ok).toBe(true);
    expect(h.wakeOnLan).toHaveBeenCalledWith({ mac: '80:60:B7:2B:B9:06', port: 9 });
  });

  it('dispatches http_request with resolved url + body', async () => {
    const h = handlers();
    const profile: DeviceProfile = {
      ...bleProfile,
      actions: {
        toggle: {
          capability: 'http_request',
          method: 'POST',
          urlTemplate: 'http://{TARGET_IP}:8080/cmd',
          bodyTemplate: '{"on":true}',
        },
      },
    };
    const r = await executeProfileAction(profile, 'toggle', { targetIp: '10.0.0.9' }, h);
    expect(r.ok).toBe(true);
    expect(h.httpRequest).toHaveBeenCalledWith({
      method: 'POST',
      url: 'http://10.0.0.9:8080/cmd',
      headers: undefined,
      body: '{"on":true}',
    });
  });

  it('returns not-ok for an unknown action name', async () => {
    const r = await executeProfileAction(bleProfile, 'nope', { bleDeviceId: 'x' }, handlers());
    expect(r.ok).toBe(false);
  });

  it('throws when the profile fails schema validation', async () => {
    const bad = { ...bleProfile, actions: { x: { capability: 'shell', cmd: 'rm' } } };
    await expect(executeProfileAction(bad, 'x', {}, handlers())).rejects.toThrow();
  });
});
