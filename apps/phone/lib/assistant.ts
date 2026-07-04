/**
 * Phone assistant: natural-language command -> CasaAction -> execution.
 * The Anthropic API key is stored in SecureStore (default seeded from env).
 */
import * as SecureStore from 'expo-secure-store';
import {
  ClaudeClient,
  formatState,
  DEFAULT_SUGGESTIONS,
  type AnthropicMessage,
  type AssistantContext,
  type CasaAction,
} from '@casacontrol/shared';
import { hubClient } from './connection';
import { devicesStore } from './devices';
import { pickAndPrint } from './controls';
import { searchMusic, playUri } from './music';

const KEY_STORE = 'anthropic_api_key';

export async function getApiKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(KEY_STORE);
  return stored ?? process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
}

export async function setApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_STORE, key);
}

async function gatherContext(): Promise<AssistantContext> {
  const devices = devicesStore.getState().devices;
  const [playback, ps5] = await Promise.all([
    hubClient.getPlayback().catch(() => null),
    hubClient.getPs5Status().catch(() => null),
  ]);
  return { devices, playback, ps5 };
}

/** Human-readable summary of what an action did, for the UI. */
async function execute(action: CasaAction): Promise<string> {
  switch (action.action) {
    case 'spotify.play':
    case 'spotify.pause':
    case 'spotify.next':
    case 'spotify.previous':
    case 'spotify.setVolume':
    case 'spotify.transfer':
    case 'spotify.playContext':
    case 'spotify.queue':
    case 'system.setVolume':
    case 'speaker.wake':
    case 'speaker.sleep':
    case 'ps5.wake':
    case 'ps5.status': {
      const res = await hubClient.sendCommand(action);
      if (!res.ok && 'error' in res) return `Couldn't do that: ${String(res.result ?? '')}`;
      return describe(action);
    }
    case 'devices.list': {
      const list = devicesStore
        .getState()
        .devices.filter((d) => !action.category || d.category === action.category);
      const online = list.filter((d) => d.online);
      return online.length
        ? `${online.length} online: ${online.map((d) => d.name).join(', ')}`
        : 'No devices online right now.';
    }
    case 'printer.print': {
      const printer = devicesStore.getState().devices.find((d) => d.kind === 'printer');
      if (!printer) return 'No printer discovered.';
      const res = await pickAndPrint(printer);
      return res.message;
    }
    case 'unknown':
      return `I couldn't map that to an action: ${action.reason}`;
  }
}

function describe(action: CasaAction): string {
  switch (action.action) {
    case 'spotify.play':
      return 'Resumed playback.';
    case 'spotify.pause':
      return 'Paused playback.';
    case 'spotify.next':
      return 'Skipped to the next track.';
    case 'spotify.previous':
      return 'Went to the previous track.';
    case 'spotify.setVolume':
      return `Set volume to ${action.volume}%.`;
    case 'system.setVolume':
      return `Set the speaker volume to ${action.volume}%.`;
    case 'spotify.transfer':
      return 'Moved playback to that device.';
    case 'speaker.wake':
      return 'Powering the speaker on…';
    case 'speaker.sleep':
      return 'Powering the speaker off…';
    case 'ps5.wake':
      return 'Waking the PS5…';
    case 'ps5.status':
      return 'Checked the PS5 status.';
    default:
      return 'Done.';
  }
}

// --- Tool-use agent wiring -------------------------------------------------

const clampVol = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

/** Friendly tool names (from ASSISTANT_TOOLS) -> CasaAction builders. */
const TOOL_TO_ACTION: Record<string, (i: Record<string, unknown>) => CasaAction> = {
  play_music: () => ({ action: 'spotify.play' }),
  pause_music: () => ({ action: 'spotify.pause' }),
  next_track: () => ({ action: 'spotify.next' }),
  previous_track: () => ({ action: 'spotify.previous' }),
  set_volume: (i) => ({ action: 'system.setVolume', volume: clampVol(i.volume) }),
  power_on_speaker: () => ({ action: 'speaker.wake' }),
  power_off_speaker: () => ({ action: 'speaker.sleep' }),
  wake_ps5: () => ({ action: 'ps5.wake' }),
};

/** Executes a tool Claude asked for and returns a short result for the model. */
async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === 'get_status') {
    return formatState(await gatherContext());
  }
  if (name === 'search_and_play') {
    const q = String(input.query ?? '').trim();
    if (!q) return 'No search query provided.';
    const results = await searchMusic(q);
    const pick = results.tracks[0] ?? results.contexts[0];
    if (!pick?.uri) return `No Spotify results for "${q}".`;
    await playUri(pick.uri);
    const label =
      'artists' in pick && pick.artists.length
        ? `${pick.name} by ${pick.artists.join(', ')}`
        : pick.name;
    return `Started playing ${label}.`;
  }
  // `play` only RESUMES — if nothing is queued it silently starts nothing.
  // Verify so the assistant reports the truth instead of claiming music plays.
  if (name === 'play_music') {
    await execute({ action: 'spotify.play' });
    const pb = await hubClient.getPlayback().catch(() => null);
    if (pb?.isPlaying && pb.track) {
      return `Playing "${pb.track.name}" by ${pb.track.artists.join(', ')}.`;
    }
    return (
      'Play was sent, but nothing is queued to resume, so no music started. ' +
      'Tell the user to open Spotify and pick a song or playlist first ' +
      '(in-app song search is on the roadmap).'
    );
  }
  const build = TOOL_TO_ACTION[name];
  if (!build) return `Unknown tool: ${name}`;
  return execute(build(input));
}

/**
 * Continue the assistant conversation. Pass the prior `history` back each turn;
 * returns the reply to show plus the updated history for the next turn.
 */
export async function runAssistantChat(
  text: string,
  history: AnthropicMessage[] = [],
): Promise<{ reply: string; history: AnthropicMessage[] }> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { reply: 'Set your Anthropic API key in Settings first.', history };
  }
  const client = new ClaudeClient({ apiKey });
  const context = await gatherContext();
  return client.chat(text, history, context, executeTool);
}

/** State-aware suggestions for the assistant sheet (falls back to defaults). */
export async function getSuggestions(): Promise<string[]> {
  const apiKey = await getApiKey();
  if (!apiKey) return DEFAULT_SUGGESTIONS;
  try {
    const client = new ClaudeClient({ apiKey });
    return await client.suggest(await gatherContext());
  } catch {
    return DEFAULT_SUGGESTIONS;
  }
}

/** Interpret + execute a single command (legacy single-shot entrypoint). */
export async function runAssistantCommand(text: string): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) return 'Set your Anthropic API key in Settings first.';

  const client = new ClaudeClient({ apiKey });
  const context = await gatherContext();
  const action = await client.interpret(text, context);
  return execute(action);
}
