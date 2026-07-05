import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

/**
 * Native Android media notification for the phone remote. Shows the hub's
 * current Spotify track in the notification shade + lock screen with
 * prev/play-pause/next controls, and emits an `onCommand` event when the user
 * taps one (which the JS layer turns into a hub command). There's no local
 * audio — this is purely a remote-control surface mirroring hub playback.
 */
export type MediaCommand = 'play' | 'pause' | 'next' | 'previous' | 'stop';

export interface NowPlaying {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string | null;
  isPlaying: boolean;
  durationMs?: number;
  positionMs?: number;
}

const Native = requireNativeModule('MediaControls');

/** Create/update the media notification to reflect the given track. */
export function setNowPlaying(info: NowPlaying): Promise<void> {
  return Native.setNowPlaying({
    title: info.title,
    artist: info.artist,
    album: info.album ?? '',
    artworkUrl: info.artworkUrl ?? null,
    isPlaying: info.isPlaying,
    durationMs: Math.max(0, Math.round(info.durationMs ?? 0)),
    positionMs: Math.max(0, Math.round(info.positionMs ?? 0)),
  });
}

/** Remove the media notification. */
export function clearNowPlaying(): void {
  Native.clear();
}

/** Subscribe to transport-control taps from the notification / lock screen. */
export function addCommandListener(
  listener: (command: MediaCommand) => void,
): EventSubscription {
  return Native.addListener('onCommand', (e: { command: MediaCommand }) =>
    listener(e.command),
  );
}
