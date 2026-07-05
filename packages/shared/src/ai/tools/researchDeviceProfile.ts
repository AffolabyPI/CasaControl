/**
 * Claude research tool: research_device_profile.
 *
 * For a genuinely unknown device (the caller MUST have checked the profile store
 * with findMatchingProfile and gotten null first — this is never called for a
 * device we already have an approved profile for), ask Claude, WITH web search,
 * to find a documented, citable control method and return a DeviceProfile that
 * fits our schema — or {found:false} if no reliable public method exists.
 *
 * Claude may not invent UUIDs/payloads: no citation ⇒ found:false. The returned
 * JSON is run through the zod validator before it can ever be queued/approved.
 */
import { safeValidateProfile, type DeviceProfile } from '../../devices/profiles/schema';
import { extractJsonObject } from '../json';

/** What discovery knows about the unknown device, handed to the researcher. */
export interface ResearchInput {
  name?: string | null;
  vendor?: string;
  model?: string;
  mac?: string | null;
  bleServiceUUIDs?: string[];
  mdnsServiceTypes?: string[];
}

export type ResearchResult =
  | { found: true; profile: DeviceProfile }
  | { found: false; reason: string };

/** The server-side web-search tool (dynamic-filtering variant for Opus 4.8/4.7). */
export const WEB_SEARCH_TOOL = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: 5,
} as const;

export function buildResearchSystemPrompt(): string {
  return [
    'You are a device-integration researcher for a home hub. Given an unknown',
    'discovered device, use web search to find a DOCUMENTED, publicly-cited way to',
    'control it that maps onto exactly one of these capabilities:',
    '  - ble_write     (serviceUUID, characteristicUUID, payloadTemplate, writeType)',
    '  - wake_on_lan   (macTemplate, optional port)',
    '  - http_request  (method, urlTemplate, headers?, bodyTemplate?)',
    '  - mdns_resolve  (serviceType)',
    '',
    'Return ONLY one JSON object, no prose, no markdown fences. Either a device',
    'profile of this exact shape:',
    '{',
    '  "profileId": "kebab-case-unique-id",',
    '  "deviceName": "Human name",',
    '  "matchHints": { "namePatterns"?: [], "macOuiPrefixes"?: [], "bleServiceUUIDs"?: [], "mdnsServiceTypes"?: [] },',
    '  "actions": { "power_on": { "capability": "ble_write", ... } },',
    '  "source": "ai_generated",',
    '  "confidence": 0.0-1.0,',
    '  "createdAt": <epoch ms>,',
    '  "citations": ["https://...", ...]',
    '}',
    'or, if there is no reliable public method: {"found": false, "reason": "..."}.',
    '',
    'HARD RULES:',
    '- NEVER invent UUIDs, payload bytes, endpoints, or MACs. Every technical value',
    '  MUST come from a source you cite in "citations". If you cannot cite it,',
    '  return {"found": false}.',
    '- BLE payloadTemplate must be hex bytes, optionally using the placeholders',
    '  {PAIRED_MAC} (this hub\'s Bluetooth MAC) or {TARGET_MAC}. Nothing else.',
    '- Use {TARGET_IP} / {TARGET_MAC} placeholders in URLs/MAC templates rather than',
    '  hard-coding this network\'s addresses.',
    '- Prefer at least one matchHint that generalises to the model (name pattern or',
    '  MAC OUI) so identical devices reuse this profile.',
    '- Set confidence honestly: high only with clear, first-party or well-established',
    '  community documentation.',
  ].join('\n');
}

export function buildResearchQuery(device: ResearchInput): string {
  const facts = [
    device.name ? `name: ${device.name}` : null,
    device.vendor ? `vendor: ${device.vendor}` : null,
    device.model ? `model: ${device.model}` : null,
    device.mac ? `mac: ${device.mac}` : null,
    device.bleServiceUUIDs?.length ? `bleServiceUUIDs: ${device.bleServiceUUIDs.join(', ')}` : null,
    device.mdnsServiceTypes?.length ? `mdnsServiceTypes: ${device.mdnsServiceTypes.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return `Research how to control this device:\n${facts}\n\nReturn the JSON described in your instructions.`;
}

/** Parse + validate the model's text into a ResearchResult. Never throws. */
export function parseResearchResult(text: string): ResearchResult {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch {
    return { found: false, reason: 'No JSON object in the model response' };
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    'found' in parsed &&
    (parsed as { found: unknown }).found === false
  ) {
    const reason = (parsed as { reason?: unknown }).reason;
    return { found: false, reason: typeof reason === 'string' ? reason : 'No public method found' };
  }
  const valid = safeValidateProfile(parsed);
  if (!valid.success) return { found: false, reason: `Generated profile was invalid: ${valid.error}` };
  if (valid.data.source !== 'ai_generated') {
    return { found: false, reason: 'Generated profile was not marked ai_generated' };
  }
  return { found: true, profile: valid.data };
}
