import { useCallback, useEffect, useRef } from 'react';
import * as Brightness from 'expo-brightness';
import { IDLE_DIM_MS } from '@casacontrol/shared';

/**
 * Keeps the hub awake but dims the screen to `dimLevel` after `timeoutMs` of no
 * touches (instead of a screensaver). Any touch restores full brightness.
 * Returns an `onActivity` handler to wire to the root View's onTouchStart.
 *
 * `enabled` is false in private mode, where the screen is meant to sleep — the
 * timer is disarmed and brightness handed back to the system.
 */
export function useIdleDim(dimLevel = 0.2, timeoutMs = IDLE_DIM_MS, enabled = true) {
  const dimmed = useRef(false);
  const restore = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setBrightness = async (v: number) => {
    try {
      await Brightness.setBrightnessAsync(v);
    } catch {
      /* brightness not available (e.g. web/emulator) */
    }
  };

  const dim = useCallback(async () => {
    if (dimmed.current) return;
    try {
      restore.current = await Brightness.getBrightnessAsync();
    } catch {
      restore.current = 1;
    }
    dimmed.current = true;
    void setBrightness(dimLevel);
  }, [dimLevel]);

  const onActivity = useCallback(() => {
    if (dimmed.current) {
      dimmed.current = false;
      void setBrightness(restore.current || 1);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void dim(), timeoutMs);
  }, [dim, timeoutMs]);

  useEffect(() => {
    if (!enabled) {
      // Private mode: stop dimming and let the OS control brightness/sleep.
      if (timer.current) clearTimeout(timer.current);
      dimmed.current = false;
      return;
    }
    onActivity(); // arm the timer on mount
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [onActivity, enabled]);

  return { onActivity };
}
