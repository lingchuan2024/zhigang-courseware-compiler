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
          950: '#f2eee5',
          900: '#f7f4ed',
          850: '#fffdf8',
          800: '#eee8dc',
          750: '#e7dfd0',
          border: '#ded5c4',
          'border-strong': '#b9ab92',
          text: '#253a46',
          muted: '#756d60',
        },
        paper: '#fffdf8',
        'paper-dark': '#eee8dc',
        ink: '#253a46',
        'ink-light': '#53616a',
        cinnabar: '#8b3d43',
        'cinnabar-light': '#a84d51',
        celadon: '#294f61',
        'celadon-light': '#38677b',
        charcoal: '#253a46',
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
          '"Songti SC"',
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
