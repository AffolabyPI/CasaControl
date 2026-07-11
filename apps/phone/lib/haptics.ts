/**
 * Tiny haptic feedback helper built on React Native's Vibration API (no extra
 * native dependency — the VIBRATE permission ships with the RN template).
 * Used for tactile feedback on the Shield remote buttons.
 */
import { Vibration, Platform } from 'react-native';

/** A light tap — for D-pad / transport / volume buttons. */
export function tapHaptic(): void {
  if (Platform.OS === 'android') Vibration.vibrate(12);
}

/** A firmer buzz — for confirming/committing actions like power. */
export function strongHaptic(): void {
  if (Platform.OS === 'android') Vibration.vibrate(28);
}
