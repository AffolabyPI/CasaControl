import { describe, it, expect } from 'vitest';
import {
  safeValidateProfile,
  validateProfile,
  isValidBlePayload,
  type DeviceProfile,
} from './schema';

/** A minimal valid ble_write profile builder. */
function bleProfile(overrides: Partial<DeviceProfile> = {}): unknown {
  return {
    profileId: 'jbl-flip-6',
    deviceName: 'JBL Flip 6',
    matchHints: { namePatterns: ['JBL Flip*'] },
    actions: {
      power_on: {
        capability: 'ble_write',
        serviceUUID: '65786365-6c65-6e63-6520-536f756e6421',
        characteristicUUID: '65786365-6c65-6e63-6520-536f756e6422',
        payloadTemplate: '01 00 {PAIRED_MAC} ff',
        writeType: 'withoutResponse',
      },
    },
    source: 'ai_generated',
    confidence: 0.7,
    createdAt: 1_700_000_000_000,
    citations: ['https://github.com/example/jbl-reverse'],
    ...overrides,
  };
}

describe('isValidBlePayload', () => {
  it('accepts hex with allowed placeholders and separators', () => {
    expect(isValidBlePayload('0100ff')).toBe(true);
    expect(isValidBlePayload('01 00 ff')).toBe(true);
    expect(isValidBlePayload('01:00:{PAIRED_MAC}:ff')).toBe(true);
    expect(isValidBlePayload('{TARGET_MAC}')).toBe(true);
  });

  it('rejects odd-length hex (partial byte)', () => {
    expect(isValidBlePayload('010')).toBe(false);
  });

  it('rejects non-hex content and injection attempts', () => {
    expect(isValidBlePayload('rm -rf /')).toBe(false);
    expect(isValidBlePayload('0x01,0x02')).toBe(false);
    expect(isValidBlePayload('01{PAIRED_MAC};DROP')).toBe(false);
  });

  it('rejects unknown placeholders', () => {
    expect(isValidBlePayload('01{EVIL}ff')).toBe(false);
    expect(isValidBlePayload('01{PAIRED_MAC_EXTRA}ff')).toBe(false);
  });

  it('rejects an unterminated placeholder brace', () => {
    expect(isValidBlePayload('01{PAIRED_MAC')).toBe(false);
  });
});

describe('deviceProfileSchema — valid profiles', () => {
  it('accepts a well-formed ble_write profile', () => {
    const r = safeValidateProfile(bleProfile());
    expect(r.success).toBe(true);
  });

  it('accepts a builtin profile with no citations', () => {
    const r = safeValidateProfile(
      bleProfile({ source: 'builtin', citations: [] }),
    );
    expect(r.success).toBe(true);
  });

  it('accepts wake_on_lan, http_request, and mdns_resolve actions', () => {
    const r = safeValidateProfile(
      bleProfile({
        actions: {
          wake: { capability: 'wake_on_lan', macTemplate: '{TARGET_MAC}', port: 9 },
          ping: {
            capability: 'http_request',
            method: 'POST',
            urlTemplate: 'http://{TARGET_IP}:8080/power',
            headers: { 'content-type': 'application/json' },
            bodyTemplate: '{"on":true}',
          },
          resolve: { capability: 'mdns_resolve', serviceType: '_googlecast._tcp' },
        },
      }),
    );
    expect(r.success).toBe(true);
  });
});

describe('deviceProfileSchema — malicious / malformed profiles are rejected', () => {
  it('rejects an unknown capability', () => {
    const r = safeValidateProfile(
      bleProfile({
        actions: {
          hack: { capability: 'shell_exec', cmd: 'rm -rf /' } as never,
        },
      }),
    );
    expect(r.success).toBe(false);
  });

  it('rejects a ble_write payload that is not hex-with-placeholders', () => {
    const bad = bleProfile() as { actions: { power_on: { payloadTemplate: string } } };
    bad.actions.power_on.payloadTemplate = 'javascript:alert(1)';
    expect(safeValidateProfile(bad).success).toBe(false);
  });

  it('rejects an ai_generated profile with no citations', () => {
    const r = safeValidateProfile(bleProfile({ source: 'ai_generated', citations: [] }));
    expect(r.success).toBe(false);
  });

  it('rejects a non-http url template', () => {
    const r = safeValidateProfile(
      bleProfile({
        actions: {
          x: { capability: 'http_request', method: 'GET', urlTemplate: 'file:///etc/passwd' },
        },
      }),
    );
    expect(r.success).toBe(false);
  });

  it('rejects a profile with no match hints', () => {
    const r = safeValidateProfile(bleProfile({ matchHints: {} as never }));
    expect(r.success).toBe(false);
  });

  it('rejects a profile with no actions', () => {
    const r = safeValidateProfile(bleProfile({ actions: {} }));
    expect(r.success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(safeValidateProfile(bleProfile({ confidence: 1.5 })).success).toBe(false);
    expect(safeValidateProfile(bleProfile({ confidence: -0.1 })).success).toBe(false);
  });

  it('rejects a bad citation URL', () => {
    const r = safeValidateProfile(bleProfile({ citations: ['not-a-url'] }));
    expect(r.success).toBe(false);
  });

  it('validateProfile throws on invalid input', () => {
    expect(() => validateProfile({ nonsense: true })).toThrow();
  });
});
