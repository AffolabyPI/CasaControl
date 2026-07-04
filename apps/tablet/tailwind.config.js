/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    '../../packages/shared/src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        gold: { DEFAULT: '#C9A84C', soft: '#E4CE8A', dark: '#9A7E2E' },
        ink: { DEFAULT: '#14140F', soft: '#1F1E17' },
        offWhite: '#F7F6F2',
        online: '#4CAF50',
        offline: '#6B6B6B',
        danger: '#E5484D',
      },
    },
  },
  plugins: [],
};
