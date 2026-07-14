/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        space: {
          950: '#010207',
          900: '#040914',
          850: '#07101d',
          800: '#0a1625',
          750: '#102238',
          border: '#1d3349',
          'border-strong': '#31536d',
          text: '#edf7fc',
          muted: '#778da2',
        },
        paper: '#07101d',
        'paper-dark': '#0a1625',
        ink: '#edf7fc',
        'ink-light': '#b1c3d1',
        cinnabar: '#d9655d',
        'cinnabar-light': '#ed8880',
        celadon: '#78cde3',
        'celadon-light': '#a8e5f3',
        charcoal: '#edf7fc',
      },
      fontFamily: {
        ui: [
          '"Noto Sans SC"',
          '"Avenir Next"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        song: [
          '"Noto Serif SC"',
          '"Source Han Serif SC"',
          'SimSun',
          'serif',
        ],
        mono: [
          '"JetBrains Mono"',
          '"SF Mono"',
          'Consolas',
          'monospace',
        ],
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
    },
  },
  plugins: [],
}
