/**
 * Device profile schema — THE SECURITY BOUNDARY.
 *
 * A DeviceProfile is pure *data* describing how to control a device by mapping
 * named actions onto one of exactly four generic capability handlers we already
 * ship. Claude may generate profiles, but they can never introduce code — only
 * data that this validator accepts. Everything an AI-generated profile can do is
 * constrained here, so treat this file as untrusted-input parsing: be strict,
 * allowlist, and reject anything surprising.
 */
import { z } from 'zod';

/** The only capabilities a profile action may use. No arbitrary execution. */
export const CAPABILITIES = ['ble_write', 'wake_on_lan', 'http_request', 'mdns_resolve'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Placeholders the executor knows how to resolve from runtime context. The
 * validator rejects any other token so a profile can't reference something
 * unresolvable or smuggle unexpected content through a template.
 */
export const ALLOWED_PLACEHOLDERS = ['PAIRED_MAC', 'TARGET_MAC', 'TARGET_IP'] as const;
export type PlaceholderName = (typeof ALLOWED_PLACEHOLDERS)[number];

const ANY_PLACEHOLDER = /\{[^}]*\}/g;
const ALLOWED_PLACEHOLDER = new RegExp(`\\{(?:${ALLOWED_PLACEHOLDERS.join('|')})\\}`, 'g');

/** True if every `{...}` token in the string is an allowed placeholder. */
function onlyAllowedPlaceholders(s: string): boolean {
  const tokens = s.match(ANY_PLACEHOLDER) ?? [];
  return tokens.every((t) => (ALLOWED_PLACEHOLDERS as readonly string[]).includes(t.slice(1, -1)));
}

/**
 * A BLE payload template must be hex bytes interleaved with allowed placeholders
 * — nothing else. This is the tightest check: it stops any non-hex data (scripts,
 * URLs, shell) from riding through a `ble_write` payload to the radio.
 */
export function isValidBlePayload(template: string): boolean {
  if (!onlyAllowedPlaceholders(template)) return false;
  // Strip allowed placeholders + byte separators; only hex may remain.
  const hex = template.replace(ALLOWED_PLACEHOLDER, '').replace(/[\s:-]/g, '');
  if (!/^[0-9a-fA-F]*$/.test(hex)) return false;
  if (hex.length % 2 !== 0) return false; // whole bytes only
  // Reject a completely empty payload (no bytes and no placeholders).
  return hex.length > 0 || (template.match(ANY_PLACEHOLDER)?.length ?? 0) > 0;
}

/** Accept 16-, 32-, or 128-bit BLE UUIDs. */
const bleUuid = z
  .string()
  .regex(
    /^(?:[0-9a-fA-F]{4}|[0-9a-fA-F]{8}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
    'must be a 16-, 32-, or 128-bit BLE UUID',
  );

/** A MAC address, or a {PLACEHOLDER} that resolves to one. */
const macOrPlaceholder = z
  .string()
  .max(64)
  .refine(
    (s) =>
      onlyAllowedPlaceholders(s) &&
      /^(?:\{[A-Z_]+\}|[0-9a-fA-F]{2}(?:[:-][0-9a-fA-F]{2}){5})$/.test(s.trim()),
    'must be a MAC address or an allowed {PLACEHOLDER}',
  );

const bleWriteSpec = z.object({
  capability: z.literal('ble_write'),
  serviceUUID: bleUuid,
  characteristicUUID: bleUuid,
  payloadTemplate: z
    .string()
    .max(512)
    .refine(isValidBlePayload, 'payloadTemplate must be hex bytes with allowed {PLACEHOLDERS} only'),
  writeType: z.enum(['withResponse', 'withoutResponse']),
});

const wakeOnLanSpec = z.object({
  capability: z.literal('wake_on_lan'),
  macTemplate: macOrPlaceholder,
  port: z.number().int().min(0).max(65535).optional(),
});

const httpRequestSpec = z.object({
  capability: z.literal('http_request'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  urlTemplate: z
    .string()
    .max(2048)
    .refine(
      (s) => onlyAllowedPlaceholders(s) && /^https?:\/\//i.test(s),
      'must be an http(s) URL using only allowed {PLACEHOLDERS}',
    ),
  headers: z.record(z.string().max(256)).optional(),
  // A request body is arbitrary by nature (JSON uses literal braces), so it isn't
  // placeholder-restricted — the executor substitutes only known {PLACEHOLDER}
  // tokens and leaves everything else, including JSON braces, untouched.
  bodyTemplate: z.string().max(8192).optional(),
});

const mdnsResolveSpec = z.object({
  capability: z.literal('mdns_resolve'),
  serviceType: z.string().min(1).max(128),
});

/** One action = exactly one capability. discriminatedUnion rejects any other. */
export const actionSpecSchema = z.discriminatedUnion('capability', [
  bleWriteSpec,
  wakeOnLanSpec,
  httpRequestSpec,
  mdnsResolveSpec,
]);
export type ProfileAction = z.infer<typeof actionSpecSchema>;

const ouiPrefix = z
  .string()
  .regex(/^[0-9a-fA-F]{2}(?:[:-]?[0-9a-fA-F]{2}){2}$/, 'OUI must be 3 octets, e.g. "10:94:97"');

export const matchHintsSchema = z
  .object({
    namePatterns: z.array(z.string().min(1).max(200)).max(20).optional(),
    macOuiPrefixes: z.array(ouiPrefix).max(20).optional(),
    bleServiceUUIDs: z.array(bleUuid).max(20).optional(),
    mdnsServiceTypes: z.array(z.string().min(1).max(128)).max(20).optional(),
  })
  .refine(
    (h) =>
      (h.namePatterns?.length ?? 0) +
        (h.macOuiPrefixes?.length ?? 0) +
        (h.bleServiceUUIDs?.length ?? 0) +
        (h.mdnsServiceTypes?.length ?? 0) >
      0,
    'at least one match hint is required',
  );
export type MatchHints = z.infer<typeof matchHintsSchema>;

export const deviceProfileSchema = z
  .object({
    profileId: z.string().min(1).max(128),
    deviceName: z.string().min(1).max(200),
    matchHints: matchHintsSchema,
    actions: z
      .record(z.string().min(1).max(64), actionSpecSchema)
      .refine((a) => Object.keys(a).length > 0, 'at least one action is required'),
    source: z.enum(['builtin', 'ai_generated']),
    confidence: z.number().min(0).max(1),
    createdAt: z.number().int().nonnegative(),
    citations: z.array(z.string().url()).max(50),
  })
  .refine(
    // AI-generated profiles must cite a source — no citation, no trust.
    (p) => p.source !== 'ai_generated' || p.citations.length > 0,
    { message: 'ai_generated profiles must include at least one citation URL', path: ['citations'] },
  );

export type DeviceProfile = z.infer<typeof deviceProfileSchema>;

/** Parse + validate, THROWING on any violation. Use before executing/saving. */
export function validateProfile(data: unknown): DeviceProfile {
  return deviceProfileSchema.parse(data);
}

/** Non-throwing validation with a flattened error string. */
export function safeValidateProfile(
  data: unknown,
): { success: true; data: DeviceProfile } | { success: false; error: string } {
  const r = deviceProfileSchema.safeParse(data);
  if (r.success) return { success: true, data: r.data };
  return {
    success: false,
    error: r.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; '),
  };
}
