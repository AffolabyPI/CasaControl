/**
 * Bridges the Spotify playback store to the native media notification.
 *
 * Mirrors the hub's now-playing track into a lock-screen / shade media
 * notification, and turns transport taps + seekbar scrubs back into store
 * actions. There's no local audio; this is a remote control surface. It follows
 * the store while the app process is alive.
 */
import { useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { createLogger } from '@casacontrol/shared';
import { store as spotifyStore } from './spotify';
import {
  setNowPlaying,
  clearNowPlaying,
  addCommandListener,
  addSeekListener,
} from '../modules/media-controls';

const log = createLogger('media-notif');

async function ensureNotifPermission(): Promise<void> {
  if (Platform.OS !== 'android' || (Platform.Version as number) < 33) return;
  const perm =
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS ??
    ('android.permission.POST_NOTIFICATIONS' as (typeof PermissionsAndroid.PERMISSIONS)['POST_NOTIFICATIONS']);
  try {
    await PermissionsAndroid.request(perm);
  } catch (e) {
    log.warn('notification permission request failed', String(e));
  }
}

/** Mount once (at the app root) to keep the media notification in sync. */
export function useMediaNotification(): void {
  useEffect(() => {
    void ensureNotifPermission();

    // The notification (our own buttons) and the system media UI (driven by the
    // MediaSession) can both emit the same command for one tap — collapse
    // duplicates fired within a short window so a single "next" skips once.
    // After a transport command, poll a couple of times: the app pauses its
    // regular polling when backgrounded, and Spotify lags a beat before it
    // reports the new track — without these the notification body goes stale
    // even though the skip worked.
    const refreshSoon = (): void => {
      setTimeout(() => void spotifyStore.getState().refresh(), 700);
      setTimeout(() => void spotifyStore.getState().refresh(), 1600);
      setTimeout(() => void spotifyStore.getState().refresh(), 3000);
    };

    let lastCmd = '';
    let lastCmdAt = 0;
    const sub = addCommandListener((cmd) => {
      const now = Date.now();
      if (cmd === lastCmd && now - lastCmdAt < 600) return;
      lastCmd = cmd;
      lastCmdAt = now;

      const s = spotifyStore.getState();
      switch (cmd) {
        case 'play':
          void s.play();
          refreshSoon();
          break;
        case 'pause':
          void s.pause();
          refreshSoon();
          break;
        case 'next':
          void s.next();
          refreshSoon();
          break;
        case 'previous':
          void s.previous();
          refreshSoon();
          break;
        case 'stop':
          clearNowPlaying();
          break;
      }
    });

    // Dragging the notification seekbar scrubs the song position.
    const seekSub = addSeekListener((positionMs) => {
      void spotifyStore.getState().seek(positionMs);
      refreshSoon();
    });

    let lastSig = '';
    const render = (): void => {
      const pb = spotifyStore.getState().playback;
      if (!pb || !pb.track) {
        if (lastSig !== '') {
          lastSig = '';
          clearNowPlaying();
        }
        return;
      }

      // Skip no-op re-renders on unrelated state changes; progressMs keeps the
      // seekbar roughly fresh on each poll.
      const sig = `${pb.track.id}|${pb.isPlaying}|${pb.progressMs}`;
      if (sig === lastSig) return;
      lastSig = sig;
      void setNowPlaying({
        title: pb.track.name,
        artist: pb.track.artists.join(', '),
        album: pb.track.album,
        artworkUrl: pb.track.albumArtUrl,
        isPlaying: pb.isPlaying,
        durationMs: pb.track.durationMs,
        positionMs: pb.progressMs,
      });
    };

    const unsub = spotifyStore.subscribe(render);
    render(); // initial

    return () => {
      sub.remove();
      seekSub.remove();
      unsub();
      clearNowPlaying();
    };
  }, []);
}
