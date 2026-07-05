/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    '../../packages/shared/src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand accent — identical in light & dark.
        gold: { DEFAULT: '#C9A84C', soft: '#E4CE8A', dark: '#9A7E2E' },
        // Themeable tokens backed by CSS vars (global.css); they flip on `.dark`.
        // rgb(var(--x) / <alpha-value>) keeps opacity utilities like text-ink/40.
        offWhite: 'rgb(var(--bg) / <alpha-value>)', // app background
        surface: 'rgb(var(--surface) / <alpha-value>)', // cards / rows
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)', // primary text/icons
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
        },
        line: 'rgb(var(--line) / <alpha-value>)', // hairline borders
        // Ink that sits on the gold accent — stays dark in both themes.
        accentInk: '#14140F',
        online: '#4CAF50',
        offline: '#6B6B6B',
        danger: '#E5484D',
      },
    },
  },
  plugins: [],
};
