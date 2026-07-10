/**
 * Claude assistant client for CasaControl.
 *
 * Runs directly against the Claude Messages API via `fetch` (React Native /
 * Hermes friendly — no Node-only SDK). The Anthropic API key lives in Expo
 * SecureStore on the phone, never in the bundle.
 *
 * Two surfaces:
 *  - `chat()` — a multi-turn tool-use agent. Claude can call the home-control
 *    tools (music, speaker, PS5, volume), chain several in one turn, refresh
 *    live state, and answer questions in natural language.
 *  - `suggest()` — 3 short, state-aware suggestions for the assistant sheet.
 *
 * The legacy single-shot `interpret()` (command -> one CasaAction) is kept for
 * any callers that still want a raw action.
 *
 * Model: claude-opus-4-8.
 */
import type {
  CasaAction,
  CasaActionName,
  Device,
  Ps5Status,
  SpotifyPlaybackState,
} from '../types';
import {
  buildResearchSystemPrompt,
  buildResearchQuery,
  parseResearchResult,
  WEB_SEARCH_TOOL,
  type ResearchInput,
  type ResearchResult,
} from './tools/researchDeviceProfile';

const MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-4-8';

export interface ClaudeConfig {
  apiKey: string;
  model?: string;
}

// --- Tool-use agent types --------------------------------------------------

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

/** One Anthropic conversation message (content is text or content blocks). */
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface AssistantTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Runs a tool the model asked for; returns a short result string for the model. */
export type ToolExecutor = (
  name: string,
  input: Record<string, unknown>,
) => Promise<string>;

/**
 * Tools Claude can call. Friendly names (not the dotted CasaAction ids) read
 * better to the model; the phone maps them back to actions when executing.
 */
export const ASSISTANT_TOOLS: AssistantTool[] = [
  { name: 'play_music', description: 'RESUME the currently loaded track (only works if something is already loaded). To start something specific, use search_and_play instead.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'search_and_play',
    description:
      'Search Spotify and START playing the best match on the speaker. Use this for any "play <song/artist/playlist/album>" request — it works even when nothing is currently playing.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to play, e.g. "Get Lucky by Daft Punk" or "lofi beats playlist".',
        },
      },
      required: ['query'],
    },
  },
  { name: 'pause_music', description: 'Pause Spotify playback.', input_schema: { type: 'object', properties: {} } },
  { name: 'next_track', description: 'Skip to the next track.', input_schema: { type: 'object', properties: {} } },
  { name: 'previous_track', description: 'Go to the previous track.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'set_volume',
    description:
      'Set the playback volume of the speaker/tablet (the UE BOOM). 0-100.',
    input_schema: {
      type: 'object',
      properties: { volume: { type: 'integer', minimum: 0, maximum: 100, description: 'Target volume 0-100' } },
      required: ['volume'],
    },
  },
  { name: 'power_on_speaker', description: 'Power ON the UE BOOM Bluetooth speaker over BLE.', input_schema: { type: 'object', properties: {} } },
  { name: 'power_off_speaker', description: 'Power OFF the UE BOOM Bluetooth speaker over BLE.', input_schema: { type: 'object', properties: {} } },
  { name: 'wake_ps5', description: 'Power on the PS5 via Wake-on-LAN.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'set_light',
    description:
      'Control the Govee smart light (e.g. the Pixel Light). Set any of: power on/off, brightness, or an RGB colour. Provide only the fields you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        on: { type: 'boolean', description: 'Turn the light on (true) or off (false).' },
        brightness: { type: 'integer', minimum: 1, maximum: 100, description: 'Brightness 1-100.' },
        red: { type: 'integer', minimum: 0, maximum: 255, description: 'Red 0-255 (with green+blue).' },
        green: { type: 'integer', minimum: 0, maximum: 255, description: 'Green 0-255.' },
        blue: { type: 'integer', minimum: 0, maximum: 255, description: 'Blue 0-255.' },
      },
    },
  },
  {
    name: 'shield_key',
    description:
      'Send a single remote-control key to the Nvidia Shield / Android TV. Use for navigation and playback: power, up, down, left, right, center (select/OK), back, home, menu, play_pause, rewind, fast_forward, volume_up, volume_down, mute.',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'One of: power, up, down, left, right, center, back, home, menu, play_pause, rewind, fast_forward, volume_up, volume_down, mute.',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'get_status',
    description:
      'Get a fresh snapshot of the home: what is playing, volume, online devices, PS5 power. Use before answering questions about current state or after acting.',
    input_schema: { type: 'object', properties: {} },
  },
];

/** Snapshot of home state handed to Claude as context. */
export interface AssistantContext {
  devices: Device[];
  playback: SpotifyPlaybackState | null;
  ps5?: Ps5Status | null;
}

/** Actions the assistant is allowed to emit, with their parameters. */
const ACTION_SPEC: Record<CasaActionName, string> = {
  'spotify.play': 'resume playback — no params',
  'spotify.pause': 'pause playback — no params',
  'spotify.next': 'skip to next track — no params',
  'spotify.previous': 'go to previous track — no params',
  'spotify.setVolume': 'set Spotify volume — { "volume": 0-100 }',
  'spotify.transfer': 'move playback to a device — { "deviceId": string }',
  'spotify.playContext': 'start playing a track/playlist/album URI — { "uri": string }',
  'spotify.playUris': 'start playing an explicit ordered list of track URIs — { "uris": string[] }',
  'spotify.queue': 'add a track URI to the queue — { "uri": string }',
  'spotify.resumeLocal':
    "resume playback on the tablet's local Spotify (cold-start while locked) — no params",
  'system.setVolume':
    'set the tablet/Bluetooth-speaker volume when Spotify volume is disallowed — { "volume": 0-100 }',
  'speaker.wake': 'power ON the Bluetooth speaker (UE BOOM) over BLE — no params',
  'speaker.sleep': 'power OFF the Bluetooth speaker (UE BOOM) over BLE — no params',
  'ps5.wake': 'power on the PS5 via Wake-on-LAN — no params',
  'ps5.status': 'report PS5 power status — no params',
  'printer.print': 'print a file — optional { "deviceId": string }',
  'devices.list': 'list devices — optional { "category": "media|printer|gaming|unknown" }',
  'govee.power': 'turn the Govee light on or off - { "on": boolean }',
  'govee.brightness': 'set the Govee light brightness - { "value": 1-100 }',
  'govee.color':
    'set the Govee light colour - { "rgb": integer } where rgb = (red<<16)|(green<<8)|blue',
  'govee.colorTemp': 'set the Govee light white temperature - { "kelvin": 2000-9000 }',
  'govee.scene': 'activate a Govee light scene - { "sceneId": number, "paramId": number }',
  'shield.key':
    'send a remote key to the Nvidia Shield - { "key": "power|up|down|left|right|center|back|home|menu|play_pause|rewind|fast_forward|volume_up|volume_down|mute" }',
  'shield.launch': 'launch an app on the Shield - { "target": "package name or deep-link uri" }',
  unknown: 'use when no action matches — { "reason": string }',
};

export function buildSystemPrompt(context: AssistantContext): string {
  const actions = Object.entries(ACTION_SPEC)
    .map(([name, desc]) => `- "${name}": ${desc}`)
    .join('\n');

  const devices = context.devices
    .map((d) => `  - ${d.name} (${d.kind}, ${d.online ? 'online' : 'offline'}, ${d.ip})`)
    .join('\n');

  const nowPlaying = context.playback?.track
    ? `${context.playback.track.name} — ${context.playback.track.artists.join(', ')} (${
        context.playback.isPlaying ? 'playing' : 'paused'
      }, volume ${context.playback.volumePercent ?? '?'}%)`
    : 'nothing playing';

  const ps5 = context.ps5 ? context.ps5.power : 'unknown';

  return [
    'You are CasaControl, a smart-home command interpreter.',
    'Convert the user command into exactly ONE action from the list below.',
    '',
    'Available actions:',
    actions,
    '',
    'Current state:',
    `- Now playing: ${nowPlaying}`,
    `- PS5 power: ${ps5}`,
    `- Devices:\n${devices || '  (none discovered)'}`,
    '',
    'Rules:',
    '- Respond with ONLY a single JSON object, no prose, no markdown fences.',
    '- The object MUST have an "action" field set to one of the action names.',
    '- Include the parameters shown for that action; omit others.',
    '- If nothing fits, use {"action":"unknown","reason":"..."}.',
  ].join('\n');
}

/** Human-readable snapshot of home state, shared by the prompts. */
export function formatState(context: AssistantContext): string {
  const nowPlaying = context.playback?.track
    ? `${context.playback.track.name} — ${context.playback.track.artists.join(', ')} (${
        context.playback.isPlaying ? 'playing' : 'paused'
      }, volume ${context.playback.volumePercent ?? '?'}%)`
    : 'nothing playing';
  const devices = context.devices
    .map((d) => `  - ${d.name} (${d.kind}, ${d.online ? 'online' : 'offline'})`)
    .join('\n');
  const ps5 = context.ps5 ? context.ps5.power : 'unknown';
  return [
    `- Now playing: ${nowPlaying}`,
    `- PS5 power: ${ps5}`,
    `- Devices:\n${devices || '  (none discovered)'}`,
  ].join('\n');
}

/** System prompt for the conversational tool-use agent. */
export function buildChatSystemPrompt(context: AssistantContext): string {
  return [
    'You are CasaControl, a friendly assistant for a home hub (a tablet) that',
    'controls Spotify playback on a UE BOOM Bluetooth speaker, the speaker power,',
    'and a PS5.',
    '',
    'You can take actions by calling the provided tools — chain several in one',
    'turn when the request needs it (e.g. "power on the speaker and play music").',
    'Answer questions about the home directly and briefly. Call get_status when',
    'you need fresh state or want to confirm the result of an action.',
    '',
    'Current state (may be slightly stale — get_status for live data):',
    formatState(context),
    '',
    'Style: concise and warm. After acting, confirm what you did in one short',
    'sentence. If a request is impossible with the available tools, say so plainly',
    'and suggest the closest thing you can do. Never invent device state.',
  ].join('\n');
}

/** Fallback suggestions if the model call fails. */
export const DEFAULT_SUGGESTIONS = [
  'Play some music',
  'Turn on the speaker',
  'What’s playing?',
];

interface RawContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}
interface RawMessageResponse {
  content?: RawContentBlock[];
  stop_reason?: string;
}

// Imported for local use and re-exported to keep existing imports working (and
// to avoid a cycle with the research tool, which also needs extractJsonObject).
import { extractJsonObject, extractJsonArray } from './json';
export { extractJsonObject, extractJsonArray };

const VALID_ACTIONS = new Set<string>(Object.keys(ACTION_SPEC));

const SHIELD_KEYS = new Set<string>([
  'power', 'up', 'down', 'left', 'right', 'center', 'back', 'home', 'menu',
  'play_pause', 'rewind', 'fast_forward', 'volume_up', 'volume_down', 'mute',
]);

/** Validate/normalize a parsed object into a safe CasaAction. */
export function coerceAction(parsed: unknown): CasaAction {
  if (typeof parsed !== 'object' || parsed === null || !('action' in parsed)) {
    return { action: 'unknown', reason: 'Malformed response' };
  }
  const obj = parsed as Record<string, unknown>;
  const action = String(obj.action);
  if (!VALID_ACTIONS.has(action)) {
    return { action: 'unknown', reason: `Unknown action "${action}"` };
  }
  switch (action) {
    case 'spotify.setVolume':
    case 'system.setVolume': {
      const volume = Math.max(0, Math.min(100, Number(obj.volume) || 0));
      return { action, volume };
    }
    case 'spotify.transfer':
      return { action, deviceId: String(obj.deviceId ?? '') };
    case 'spotify.playContext':
    case 'spotify.queue':
      return { action, uri: String(obj.uri ?? '') };
    case 'govee.power':
      return { action, on: Boolean(obj.on) };
    case 'govee.brightness':
      return { action, value: Math.max(1, Math.min(100, Number(obj.value) || 1)) };
    case 'govee.color':
      return { action, rgb: (Number(obj.rgb) || 0) & 0xffffff };
    case 'govee.colorTemp':
      return { action, kelvin: Math.max(2000, Math.min(9000, Number(obj.kelvin) || 4000)) };
    case 'govee.scene':
      return { action, sceneId: Number(obj.sceneId) || 0, paramId: Number(obj.paramId) || 0 };
    case 'shield.key': {
      const key = String(obj.key ?? '');
      return SHIELD_KEYS.has(key)
        ? { action, key: key as never }
        : { action: 'unknown', reason: `Unknown Shield key "${key}"` };
    }
    case 'shield.launch':
      return { action, target: String(obj.target ?? '') };
    case 'printer.print':
      return { action, deviceId: obj.deviceId ? String(obj.deviceId) : undefined };
    case 'devices.list':
      return {
        action,
        category: obj.category ? (String(obj.category) as never) : undefined,
      };
    case 'unknown':
      return { action: 'unknown', reason: String(obj.reason ?? 'No reason given') };
    default:
      return { action } as CasaAction;
  }
}

/** Max tool-execution rounds per user turn (guards against loops). */
const MAX_TOOL_ROUNDS = 6;

export class ClaudeClient {
  constructor(private readonly config: ClaudeConfig) {}

  /** Low-level POST to the Messages API. */
  private async post(body: Record<string, unknown>): Promise<RawMessageResponse> {
    const res = await fetch(MESSAGES_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Allow calling the API directly from an app runtime.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: this.config.model ?? DEFAULT_MODEL, ...body }),
    });
    if (!res.ok) {
      throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as RawMessageResponse;
  }

  /**
   * Multi-turn tool-use agent. Appends `userText` to `history`, lets Claude call
   * home-control tools (executed via `executeTool`) until it produces a final
   * natural-language reply. Returns the reply plus the updated history so the
   * caller can continue the conversation.
   */
  async chat(
    userText: string,
    history: AnthropicMessage[],
    context: AssistantContext,
    executeTool: ToolExecutor,
  ): Promise<{ reply: string; history: AnthropicMessage[] }> {
    const messages: AnthropicMessage[] = [
      ...history,
      { role: 'user', content: userText },
    ];
    let reply = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const data = await this.post({
        max_tokens: 1024,
        system: buildChatSystemPrompt(context),
        tools: ASSISTANT_TOOLS,
        messages,
      });
      const content = (data.content ?? []) as RawContentBlock[];

      // Record the assistant turn verbatim (tool_use blocks must be replayed).
      messages.push({ role: 'assistant', content: content as ContentBlock[] });

      const text = content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(' ')
        .trim();
      const toolUses = content.filter((b) => b.type === 'tool_use');

      if (toolUses.length === 0) {
        reply = text || 'Done.';
        break;
      }
      if (text) reply = text; // keep any narration in case we stop early

      const results: ContentBlock[] = [];
      for (const tu of toolUses) {
        let out: string;
        try {
          out = await executeTool(tu.name ?? '', tu.input ?? {});
        } catch (e) {
          out = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
        results.push({ type: 'tool_result', tool_use_id: tu.id ?? '', content: out });
      }
      messages.push({ role: 'user', content: results });
    }

    return { reply: reply || 'Done.', history: messages };
  }

  /** 3 short, state-aware suggestions for the assistant sheet. */
  async suggest(context: AssistantContext): Promise<string[]> {
    try {
      const data = await this.post({
        max_tokens: 200,
        system: [
          'You are CasaControl. Given the current home state, suggest exactly 3',
          'short, useful things the user might want to do RIGHT NOW.',
          'Each suggestion is an imperative command of at most 5 words that the',
          'assistant can perform: control music (play/pause/skip/volume), power the',
          'UE BOOM speaker on/off, or wake the PS5. Vary them to fit the state',
          '(e.g. if music is playing, offer pause/volume; if the speaker is off,',
          'offer to power it on). Return ONLY a JSON array of 3 strings.',
        ].join(' '),
        messages: [{ role: 'user', content: `Current state:\n${formatState(context)}` }],
      });
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      const arr = extractJsonArray(text);
      if (Array.isArray(arr) && arr.length) return arr.map(String).slice(0, 3);
    } catch {
      /* fall through to defaults */
    }
    return DEFAULT_SUGGESTIONS;
  }

  /**
   * Research a control profile for an unknown device using web search. The
   * caller MUST have checked the profile store (findMatchingProfile) and gotten
   * null before calling this — research never runs for a device we already have
   * an approved profile for. Returns a validated profile or {found:false}.
   */
  async researchDeviceProfile(device: ResearchInput): Promise<ResearchResult> {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: buildResearchQuery(device) },
    ];
    let text = '';
    // Server-side web_search makes the API return stop_reason "pause_turn" while
    // it runs searches; keep re-sending the turn until it finishes (end_turn),
    // accumulating the final text (which holds the JSON).
    for (let round = 0; round < 5; round++) {
      const data = await this.post({
        max_tokens: 4096,
        system: buildResearchSystemPrompt(),
        tools: [WEB_SEARCH_TOOL],
        messages,
      });
      const content = (data.content ?? []) as RawContentBlock[];
      messages.push({ role: 'assistant', content: content as ContentBlock[] });
      const turnText = content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n');
      if (turnText) text = turnText;
      if (data.stop_reason !== 'pause_turn') break;
    }
    return parseResearchResult(text);
  }

  /** Interpret a natural-language command into a single CasaAction (legacy). */
  async interpret(command: string, context: AssistantContext): Promise<CasaAction> {
    const data = await this.post({
      max_tokens: 512,
      system: buildSystemPrompt(context),
      messages: [{ role: 'user', content: command }],
    });
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return coerceAction(extractJsonObject(text));
  }
}
