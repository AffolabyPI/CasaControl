/**
 * Controls the tablet's own media (STREAM_MUSIC) volume — which is what the
 * connected Bluetooth speaker (e.g. UE BOOM) actually plays at. The phone drives
 * this over the hub when Spotify's API refuses volume for the active device.
 */
import { VolumeManager } from 'react-native-volume-manager';
import { createLogger } from '@casacontrol/shared';

const log = createLogger('volume');

/** Current media volume as an integer percent 0–100. */
export async function getSystemVolumePercent(): Promise<number> {
  try {
    const r = await VolumeManager.getVolume();
    const v = typeof r === 'number' ? r : (r?.volume ?? 0);
    return Math.round(v * 100);
  } catch (e) {
    log.error('getVolume failed', String(e));
    return 0;
  }
}

/** Set the media volume from an integer percent 0–100. */
export async function setSystemVolumePercent(percent: number): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.round(percent))) / 100;
  try {
    await VolumeManager.setVolume(v, { type: 'music', showUI: false });
    log.info(`media volume set to ${Math.round(v * 100)}%`);
  } catch (e) {
    log.error('setVolume failed', String(e));
    throw e;
  }
}
