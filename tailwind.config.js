/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: '#f5f0e8',
        'paper-dark': '#ebe4d8',
        ink: '#1a3a32',
        'ink-light': '#2d5a4d',
        cinnabar: '#c23a2b',
        'cinnabar-light': '#e85d4e',
        celadon: '#2a9d8f',
        'celadon-light': '#4ab8a9',
        charcoal: '#2c2c2c',
      },
      fontFamily: {
        song: ['"Noto Serif SC"', '"Source Han Serif SC"', 'SimSun', 'serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
