import { describe, it, expect } from 'vitest';
import {
  profileMatches,
  findMatchingProfile,
  createProfileStore,
  type ProfileStorage,
  type DeviceMatchInput,
} from './store';
import type { DeviceProfile } from './schema';

function mkProfile(over: Partial<DeviceProfile> & { profileId: string }): DeviceProfile {
  return {
    deviceName: over.deviceName ?? over.profileId,
    matchHints: over.matchHints ?? { namePatterns: ['*'] },
    actions: over.actions ?? {
      power_on: { capability: 'wake_on_lan', macTemplate: '{TARGET_MAC}' },
    },
    source: over.source ?? 'ai_generated',
    confidence: over.confidence ?? 0.7,
    createdAt: over.createdAt ?? 1,
    citations: over.citations ?? (over.source === 'builtin' ? [] : ['https://example.com/x']),
    ...over,
  } as DeviceProfile;
}

describe('profileMatches', () => {
  it('matches on a name glob', () => {
    const p = mkProfile({ profileId: 'jbl', matchHints: { namePatterns: ['JBL Flip*'] } });
    expect(profileMatches(p, { name: 'JBL Flip 6' })).toBe(true);
    expect(profileMatches(p, { name: 'Sonos One' })).toBe(false);
  });

  it('matches on a MAC OUI prefix', () => {
    const p = mkProfile({ profileId: 'ue', matchHints: { macOuiPrefixes: ['10:94:97'] } });
    expect(profileMatches(p, { mac: '10:94:97:08:49:ED' })).toBe(true);
    expect(profileMatches(p, { mac: 'AA:BB:CC:00:11:22' })).toBe(false);
  });

  it('matches an advertised BLE UUID regardless of short/long form', () => {
    const p = mkProfile({
      profileId: 'x',
      matchHints: { bleServiceUUIDs: ['0000fe00-0000-1000-8000-00805f9b34fb'] },
    });
    expect(profileMatches(p, { bleServiceUUIDs: ['fe00'] })).toBe(true);
  });

  it('matches an mDNS service type', () => {
    const p = mkProfile({ profileId: 'c', matchHints: { mdnsServiceTypes: ['_googlecast._tcp'] } });
    expect(profileMatches(p, { mdnsServiceTypes: ['_googlecast._tcp'] })).toBe(true);
  });
});

describe('findMatchingProfile — priority + reuse', () => {
  const device: DeviceMatchInput = { name: 'JBL Flip 6', mac: '10:94:97:00:00:01' };

  it('returns null when nothing matches (research eligible)', () => {
    const p = mkProfile({ profileId: 'a', matchHints: { namePatterns: ['Sonos*'] } });
    expect(findMatchingProfile([p], device)).toBeNull();
  });

  it('prefers a builtin profile over an ai_generated one', () => {
    const ai = mkProfile({
      profileId: 'ai',
      source: 'ai_generated',
      confidence: 0.99,
      matchHints: { namePatterns: ['JBL*'] },
    });
    const builtin = mkProfile({
      profileId: 'builtin',
      source: 'builtin',
      confidence: 0.5,
      matchHints: { namePatterns: ['JBL*'] },
    });
    const winner = findMatchingProfile([ai, builtin], device);
    expect(winner?.profileId).toBe('builtin');
  });

  it('a SECOND identical device reuses the same stored profile', () => {
    const profile = mkProfile({
      profileId: 'jbl-flip-6',
      matchHints: { namePatterns: ['JBL Flip*'], macOuiPrefixes: ['10:94:97'] },
    });
    const first = findMatchingProfile([profile], { name: 'JBL Flip 6', mac: '10:94:97:00:00:01' });
    const second = findMatchingProfile([profile], { name: 'JBL Flip 6', mac: '10:94:97:AB:CD:EF' });
    expect(first?.profileId).toBe('jbl-flip-6');
    expect(second?.profileId).toBe('jbl-flip-6'); // no new research needed
  });

  it('among ai_generated, higher confidence wins', () => {
    const low = mkProfile({ profileId: 'low', confidence: 0.4, matchHints: { namePatterns: ['JBL*'] } });
    const high = mkProfile({ profileId: 'high', confidence: 0.9, matchHints: { namePatterns: ['JBL*'] } });
    expect(findMatchingProfile([low, high], device)?.profileId).toBe('high');
  });
});

describe('createProfileStore', () => {
  function memStorage(initial: DeviceProfile[] = []): ProfileStorage & { data: DeviceProfile[] } {
    const data = [...initial];
    return {
      data,
      async load() {
        return [...data];
      },
      async upsert(p) {
        const i = data.findIndex((x) => x.profileId === p.profileId);
        if (i >= 0) data[i] = p;
        else data.push(p);
      },
      async remove(id) {
        const i = data.findIndex((x) => x.profileId === id);
        if (i >= 0) data.splice(i, 1);
      },
    };
  }

  it('save → find returns the cached profile (no research needed next time)', async () => {
    const storage = memStorage();
    const store = createProfileStore(storage);
    await store.init();
    const device: DeviceMatchInput = { name: 'JBL Flip 6' };
    expect(await store.findMatchingProfile(device)).toBeNull();

    await store.saveProfile(mkProfile({ profileId: 'jbl', matchHints: { namePatterns: ['JBL*'] } }));
    expect((await store.findMatchingProfile(device))?.profileId).toBe('jbl');
    expect(storage.data).toHaveLength(1); // persisted
  });

  it('delete makes the device eligible for research again', async () => {
    const storage = memStorage();
    const store = createProfileStore(storage);
    await store.init();
    await store.saveProfile(mkProfile({ profileId: 'jbl', matchHints: { namePatterns: ['JBL*'] } }));
    await store.deleteProfile('jbl');
    expect(await store.findMatchingProfile({ name: 'JBL Flip 6' })).toBeNull();
  });

  it('builtins are always present and win', async () => {
    const builtin = mkProfile({ profileId: 'ueboom', source: 'builtin', matchHints: { macOuiPrefixes: ['10:94:97'] } });
    const store = createProfileStore(memStorage(), [builtin]);
    await store.init();
    expect((await store.findMatchingProfile({ mac: '10:94:97:08:49:ED' }))?.profileId).toBe('ueboom');
    expect(store.listProfiles()).toHaveLength(1);
  });

  it('saveProfile rejects an invalid profile', async () => {
    const store = createProfileStore(memStorage());
    await store.init();
    await expect(store.saveProfile({ bogus: true } as never)).rejects.toThrow();
  });
});
