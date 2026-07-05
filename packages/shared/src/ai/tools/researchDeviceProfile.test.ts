import { describe, it, expect } from 'vitest';
import { parseResearchResult, buildResearchQuery } from './researchDeviceProfile';

const validProfileJson = JSON.stringify({
  profileId: 'jbl-flip-6',
  deviceName: 'JBL Flip 6',
  matchHints: { namePatterns: ['JBL Flip*'] },
  actions: {
    power_on: {
      capability: 'ble_write',
      serviceUUID: '0000fe00-0000-1000-8000-00805f9b34fb',
      characteristicUUID: '0000fe01-0000-1000-8000-00805f9b34fb',
      payloadTemplate: '01 02 03',
      writeType: 'withoutResponse',
    },
  },
  source: 'ai_generated',
  confidence: 0.6,
  createdAt: 1_700_000_000_000,
  citations: ['https://github.com/example/jbl'],
});

describe('parseResearchResult', () => {
  it('returns found:true with a validated profile', () => {
    const r = parseResearchResult(`Here you go:\n${validProfileJson}`);
    expect(r.found).toBe(true);
    if (r.found) expect(r.profile.profileId).toBe('jbl-flip-6');
  });

  it('passes through an explicit found:false', () => {
    const r = parseResearchResult('{"found": false, "reason": "no public protocol"}');
    expect(r.found).toBe(false);
    if (!r.found) expect(r.reason).toMatch(/no public protocol/);
  });

  it('rejects a profile with no citations (invalid → found:false)', () => {
    const noCite = JSON.parse(validProfileJson);
    noCite.citations = [];
    const r = parseResearchResult(JSON.stringify(noCite));
    expect(r.found).toBe(false);
  });

  it('rejects a profile with an unknown capability', () => {
    const bad = JSON.parse(validProfileJson);
    bad.actions.power_on = { capability: 'shell_exec', cmd: 'rm -rf /' };
    const r = parseResearchResult(JSON.stringify(bad));
    expect(r.found).toBe(false);
  });

  it('returns found:false when there is no JSON at all', () => {
    expect(parseResearchResult('I could not find anything.').found).toBe(false);
  });

  it('rejects a profile not marked ai_generated', () => {
    const b = JSON.parse(validProfileJson);
    b.source = 'builtin';
    expect(parseResearchResult(JSON.stringify(b)).found).toBe(false);
  });
});

describe('buildResearchQuery', () => {
  it('includes the known device facts', () => {
    const q = buildResearchQuery({ name: 'JBL Flip 6', vendor: 'JBL', mac: '10:94:97:00:00:01' });
    expect(q).toMatch(/JBL Flip 6/);
    expect(q).toMatch(/10:94:97:00:00:01/);
  });
});
