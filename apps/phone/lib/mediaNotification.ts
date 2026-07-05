/**
 * Bridges the Spotify playback store to the native media notification.
 *
 * Mirrors the hub's now-playing track into a lock-screen / shade media
 * notification, and turns transport taps back into store actions (which the
 * store routes to the hub / Spotify). There's no local audio — this is a remote
 * control surface. It follows the store while the app process is alive; it isn't
 * backed by a foreground service, so a long-backgrounded app may stop updating
 * until reopened.
 */
import { useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { createLogger } from '@casacontrol/shared';
import { store as spotifyStore } from './spotify';
import { setNowPlaying, clearNowPlaying, addCommandListener } from '../modules/media-controls';

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

    const sub = addCommandListener((cmd) => {
      const s = spotifyStore.getState();
      switch (cmd) {
        case 'play':
          void s.play();
          break;
        case 'pause':
          void s.pause();
          break;
        case 'next':
          void s.next();
          break;
        case 'previous':
          void s.previous();
          break;
        case 'stop':
          clearNowPlaying();
          break;
      }
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
      unsub();
      clearNowPlaying();
    };
  }, []);
}
