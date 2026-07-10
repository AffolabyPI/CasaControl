import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoveeController, GoveeError, rgbToInt, intToRgb } from './govee';

describe('rgb encoding', () => {
  it('packs and unpacks an RGB triple', () => {
    expect(rgbToInt(255, 0, 0)).toBe(0xff0000);
    expect(rgbToInt(0, 255, 0)).toBe(0x00ff00);
    expect(rgbToInt(0, 0, 255)).toBe(0x0000ff);
    expect(rgbToInt(18, 52, 86)).toBe(0x123456);
    expect(intToRgb(0x123456)).toEqual({ r: 0x12, g: 0x34, b: 0x56 });
  });

  it('clamps out-of-range channels', () => {
    expect(rgbToInt(300, -5, 255)).toBe(0xff00ff);
  });
});

// A tiny fetch stub that records calls and returns a canned JSON body.
function stubFetch(body: unknown, opts: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  // @ts-expect-error test stub
  global.fetch = fn;
  return calls;
}

describe('GoveeController', () => {
  const g = new GoveeController('test-key');

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('sends the API key header and correct control payload for power', async () => {
    const calls = stubFetch({ code: 200, message: 'success' });
    await g.setPower('H6630', 'AA:BB', true);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toContain('/router/api/v1/device/control');
    expect((init.headers as Record<string, string>)['Govee-API-Key']).toBe('test-key');
    const sent = JSON.parse(init.body as string);
    expect(sent.payload.sku).toBe('H6630');
    expect(sent.payload.device).toBe('AA:BB');
    expect(sent.payload.capability).toMatchObject({
      type: 'devices.capabilities.on_off',
      instance: 'powerSwitch',
      value: 1,
    });
    expect(sent.requestId).toBeTruthy();
  });

  it('encodes colour as a packed integer', async () => {
    const calls = stubFetch({ code: 200 });
    await g.setColorRgb('H6630', 'AA:BB', rgbToInt(0, 80, 255));
    const sent = JSON.parse(calls[0]!.init.body as string);
    expect(sent.payload.capability.instance).toBe('colorRgb');
    expect(sent.payload.capability.value).toBe(0x0050ff);
  });

  it('summarizes device capabilities from the list response', async () => {
    stubFetch({
      code: 200,
      data: [
        {
          sku: 'H6630',
          device: 'AA:BB',
          deviceName: 'Pixel Light',
          type: 'devices.types.light',
          capabilities: [
            { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
            { type: 'devices.capabilities.color_setting', instance: 'colorRgb' },
            { type: 'devices.capabilities.dynamic_scene', instance: 'lightScene' },
          ],
        },
      ],
    });
    const devices = await g.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      sku: 'H6630',
      device: 'AA:BB',
      name: 'Pixel Light',
      capabilities: { power: true, colorRgb: true, scenes: true, brightness: false, colorTemp: false },
    });
  });

  it('parses dynamic scenes from the scenes response', async () => {
    stubFetch({
      code: 200,
      payload: {
        capabilities: [
          {
            type: 'devices.capabilities.dynamic_scene',
            instance: 'lightScene',
            parameters: {
              options: [
                { name: 'Sunrise', value: { id: 11, paramId: 22 } },
                { name: 'Aurora', value: { id: 33, paramId: 44 } },
              ],
            },
          },
        ],
      },
    });
    const scenes = await g.listScenes('H6630', 'AA:BB');
    expect(scenes).toEqual([
      { name: 'Sunrise', id: 11, paramId: 22 },
      { name: 'Aurora', id: 33, paramId: 44 },
    ]);
  });

  it('throws GoveeError on a non-200 logical code', async () => {
    stubFetch({ code: 401, message: 'invalid api key' });
    await expect(g.listDevices()).rejects.toBeInstanceOf(GoveeError);
  });

  it('throws GoveeError on an HTTP error', async () => {
    stubFetch({ message: 'rate limited' }, { ok: false, status: 429 });
    await expect(g.setPower('H6630', 'AA:BB', false)).rejects.toMatchObject({ status: 429 });
  });
});
