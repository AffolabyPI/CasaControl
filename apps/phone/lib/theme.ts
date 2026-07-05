/**
 * Phone theming: light (off-white & gold) + dark, following the system by
 * default with a manual override in Settings.
 *
 * Two color surfaces are themed:
 *  - NativeWind class tokens (`bg-offWhite`, `text-ink`, `bg-surface`,
 *    `border-line`) are backed by CSS variables that flip on the `.dark` class
 *    (see global.css + tailwind.config.js). NativeWind's `colorScheme` toggles
 *    that class.
 *  - Inline colors (icon tints, slider colors, placeholders) can't read CSS
 *    vars, so `useThemeColors()` returns the active JS palette for those.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { colorScheme as nwColorScheme, useColorScheme, vars } from 'nativewind';
import { COLORS, createLogger } from '@casacontrol/shared';

const log = createLogger('theme');
const KEY = 'theme_mode';

export type ThemeMode = 'system' | 'light' | 'dark';

// The class-token CSS variables (see tailwind.config.js). On native there's no
// DOM root for a `.dark` selector to attach to, so we inject the variable values
// at runtime with `vars()` on a root view instead of relying on global.css.
export const THEME_VARS = {
  light: vars({
    '--bg': '247 246 242',
    '--surface': '255 255 255',
    '--ink': '20 20 15',
    '--ink-soft': '31 30 23',
    '--line': '0 0 0',
  }),
  dark: vars({
    '--bg': '18 18 16',
    '--surface': '32 31 26',
    '--ink': '244 243 239',
    '--ink-soft': '232 231 225',
    '--line': '255 255 255',
  }),
};

// `accentInk` is the ink used ON the gold accent (buttons). Gold is identical in
// both themes, so its foreground stays dark regardless of the active scheme.
export const LIGHT = {
  ...COLORS,
  accentInk: '#14140F',
  track: '#00000022', // slider max-track (subtle dark on light)
} as const;
export const DARK = {
  ...COLORS,
  ink: '#F4F3EF',
  inkSoft: '#E8E7E1',
  muted: '#9B9788',
  offWhite: '#121210', // app background
  white: '#201F1A', // card / surface
  accentInk: '#14140F',
  track: '#FFFFFF22', // slider max-track (subtle light on dark)
} as const;

// Widen literal values to `string` so LIGHT and DARK share one type.
export type ThemePalette = { readonly [K in keyof typeof LIGHT]: string };

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  hydrate: () => Promise<void>;
}

export const themeStore = createStore<ThemeState>((set) => ({
  mode: 'system',
  setMode: (mode) => {
    nwColorScheme.set(mode);
    set({ mode });
    void SecureStore.setItemAsync(KEY, mode).catch((e) => log.warn('persist failed', String(e)));
  },
  hydrate: async () => {
    const saved = ((await SecureStore.getItemAsync(KEY)) as ThemeMode | null) ?? 'system';
    nwColorScheme.set(saved);
    set({ mode: saved });
  },
}));

export const useThemeMode = () => useStore(themeStore, (s) => s.mode);
export const setThemeMode = (m: ThemeMode) => themeStore.getState().setMode(m);

/** Active JS palette for inline (non-className) colors. Re-renders on scheme change. */
export function useThemeColors(): ThemePalette {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? DARK : LIGHT;
}

/** Whether the effective scheme is dark (for StatusBar, etc.). */
export function useIsDark(): boolean {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark';
}

/**
 * CSS-variable style for the active scheme. Apply to a root view (and to any
 * RN <Modal> content, which portals outside the root tree) so the class tokens
 * resolve correctly on native.
 */
export function useThemeVars() {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? THEME_VARS.dark : THEME_VARS.light;
}
